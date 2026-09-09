# v2.3.3-beta.73：真机反馈第二轮——弹层交互、触控高亮、拖动滚动锁与顶栏压缩

日期：2026-09-05。基线：beta.72（正式渠道，版本号 2.3.3-beta.73）。范围：真机 8 项反馈，全部从根源定位；无法在桌面复现的项按机制推导修复并标注真机复验。

## 逐项根因与实现

1. **悬浮条控件居中**：桌面测量列表悬浮条与详情 dock 各控件中心线完全一致（如 80/80/80），设备偏差源于 iOS 字体行盒。搜索框 `line-height: 28px`（与高度一致）、dock `.barText { line-height: 1 }`，消除 CJK 字形在 iOS 行盒中的视觉偏移。
2. **点击标签栏出现长灰条**：构建 CSS 已核实触发栏背景透明，灰条是 iOS `-webkit-tap-highlight-color` 默认高亮——触发栏 `width: 100%`，点击时整条变灰。a11y 层对 `button/[role=button]/input/select/label` 全局 `-webkit-tap-highlight-color: transparent`，按压反馈统一由 `:active opacity` 承担。
3. **分隔线上深下浅**：侧栏统一滚动容器在右缘硬裁剪溢出；悬浮条投影 blur 18px 横向扩散超过 8px 右边距，被裁剪的投影在顶部形成一段深色竖边。投影收紧为 `0 4px 10px -7px rgba(37,48,67,.14)`（横向扩散 ≤ 8px 不再触界）。
4. **面板拖到顶部白条、底部被裁**：拖动时 UIWebView scrollView 随手势位移 contentOffset/附加顶部 inset。`handleHeaderPan` 开始时 `scrollView.scrollEnabled = false`，结束/取消/失败时恢复并执行 `lockWebViewRootScroll`（清零 inset/offset）。窗口位置仍完全自由；`tests/web-bridge.test.ts` 增加滚动锁断言。
5. **删除标签弹窗被标签菜单盖住**：beta.72 弹层 portal 挂 body（z 300）后，仍在 `main`（z 1 层叠上下文）内的确认弹窗层级永远更低。删除确认与迁移确认弹窗 portal 到 body，遮罩 `z-index: 1000`。
6. **新建标签输入框键盘闪退**：聚焦时 iOS 自动滚动露出输入框，触发「滚动即关闭」，菜单卸载键盘收起。`useScrollDismiss` 增加容器豁免：滚动目标在弹层内（自身列表滚动）或弹层内存在聚焦元素时不再关闭；分类、日期、标签菜单三个弹层接入各自容器 ref。
7. **全部分类下拉无法下滑**：同 6，首次下滑即被关闭。豁免后真实可滚动态（255/213）滚动 40px 仍打开。
8. **分类下拉文字用色**：portal 后文字色依赖继承链；显式取规范 ink（选项/标题/收藏行），收藏行仅激活态 accent。桌面计算色本为墨色，未复现蓝字，如真机仍见请截图。
9. **悬停统一审计**：桌面 27 项交互控件逐一审计（顶栏、悬浮条、列表项、详情、dock、待复习），全部存在可见悬停反馈，专用状态底色（active/选中/到期/复测档位）悬停不被覆盖。
10. **顶栏压缩**：TITLE_HEIGHT 与 `--mn-topbar-height` 56 → 48（窄屏 50 → 44），定位横幅 top 62 → 54；原生拖拽热区随之 48px，仍高于 44pt 触控标准。

## 影响文件

`rails-native/WebPanelController.js`、`rails-native/ui-constants.js`、`web/src/main.jsx`、`web/src/a11y.css`、`web/src/ui/{mistakes,detail,tokens,shell}.css`、`tests/web-bridge.test.ts`、`package.json`（版本号）、`RELEASE_NOTES_v2.3.3-beta.73.md`（新增）。

## 兼容性与数据影响

- 数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。
- 迁移确认弹窗挂载点移到 body，按钮类名与行为不变。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.73.mnaddon`（489818 字节，SHA-256 `2052E90CD2BEB31852389614C2D9580B1DA502BF5E7E68A1F2F83FACA316CCD3`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.73.mnaddon`，副本与原包哈希一致。
- 包内 `mnaddon.json`：正式插件 ID、正式标题、版本 `2.3.3-beta.73`。
- Playwright：分类弹层可下滑且自身滚动不关闭；聚焦新建标签输入框后滚动事件不关闭菜单；删除确认弹窗挂 body、z 1000 盖过标签菜单（截图 `output/playwright/b73-delete-top.png`）；顶栏 48px；悬浮条控件中心线一致；27 项悬停审计全部通过；窄窗标签菜单完整。

## 未验证限制（需真机）

- 拖到顶部白条（`scrollEnabled` 经 JSB 可写性待实机确认）。
- 分隔线上深下浅（投影收紧效果）、点击标签栏灰条（点击高亮关闭）、输入框键盘不闪退（真实键盘）、悬浮条控件视觉居中（PingFang 行盒）。
- 「分类下拉蓝字」未复现，已按规范显式上墨色；复现请提供截图。
