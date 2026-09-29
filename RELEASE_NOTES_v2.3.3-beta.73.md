# v2.3.3-beta.73

基线：beta.72。处理真机 8 项反馈：悬浮条控件居中、标签栏点击灰条、分隔线上深下浅、拖到顶部白条、删除标签弹窗层级与输入框键盘闪退、分类弹层无法下滑与文字用色、悬停效果统一审计、顶栏高度压缩。

## 逐项根因与实现

1. **悬浮条控件居中**：桌面测量各控件中心线完全一致（80/80/80），设备偏差来自 iOS 字体行盒：搜索框文本与详情操作条文字改用显式行高（input `line-height: 28px` 与高度一致；dock `.barText { line-height: 1 }`），CJK 字形在 iOS 行盒中的偏移被消除。需真机复验。
2. **点击标签栏出现长灰条**：根因是 iOS `-webkit-tap-highlight-color` 默认灰色高亮——标签触发栏 `width: 100%`，点击时整条被高亮成灰条（构建 CSS 中触发栏背景本就透明，已核实）。在 a11y 触控反馈层全局对 `button/[role=button]/input/select/label` 关闭点击高亮，按压反馈统一由 `:active opacity` 承担。
3. **分隔线上深下浅**：侧栏统一滚动容器会在右缘硬裁剪溢出内容；悬浮筛选条投影（blur 18px）横向扩散超过其 8px 右边距，被裁剪的投影在顶部形成一段比分隔线更深的竖边。投影收紧为 `0 4px 10px -7px`（横向扩散 ≤ 8px，不再触界）。需真机复验。
4. **面板拖到顶部出现白条、底部被裁**：拖动时 UIWebView 的 scrollView 随手势位移 contentOffset/附加顶部 inset。`handleHeaderPan` 在手势开始（state began）设置 `scrollView.scrollEnabled = false` 锁死滚动，结束/取消/失败时恢复并执行既有 `lockWebViewRootScroll`（清零 inset 与 offset）。窗口位置仍完全自由。需真机复验。
5. **删除标签弹窗被标签菜单盖住**：弹层 beta.72 起 portal 挂 body（z 300），而确认弹窗仍在 `main`（z 1 层叠上下文）内，层级上永远低于弹层。删除确认弹窗与迁移确认弹窗一并 portal 到 body，遮罩 `z-index: 1000` 置顶。
6. **新建标签输入框键盘闪退**：聚焦输入框时 iOS 自动滚动页面露出输入框，触发 beta.72 的「滚动即关闭」，菜单卸载导致键盘立即收起。`useScrollDismiss` 增加两类豁免：滚动目标在弹层容器内（弹层自身选项列表的滚动）与弹层内存在聚焦元素（输入框自动滚动）时不再关闭。
7. **全部分类下拉无法下滑**：同 6——下滑弹层自身列表被「滚动即关闭」误杀，首次拖动即整层消失。经弹层容器豁免后可正常下滑（真实可滚动态实测滚动 40px 后仍打开）。
8. **分类下拉文字用色**：弹层 portal 后文字色依赖继承链，显式取规范 ink（`--rd-ink`/`--study-ink`）：选项、弹层标题、收藏行均为墨色；收藏行仅激活态用 accent 蓝。如真机仍见蓝字请截图反馈。
9. **悬停效果统一**：桌面逐控件审计 27 项（顶栏页签/图标钮、悬浮条全部控件、列表项、详情芯片/标签栏、dock 六钮、待复习全部控件）——全部存在可见悬停反馈，active/选中/到期等专用状态底色悬停不再被覆盖。
10. **顶栏高度压缩**：56 → 48（窄屏 50 → 44）。`ui-constants.js TITLE_HEIGHT`（原生拖拽热区）与 `tokens.css` 回退值同步修改，定位提示横幅 top 62 → 54。

## 影响文件

- `rails-native/WebPanelController.js`：拖动期滚动锁。
- `rails-native/ui-constants.js`：TITLE_HEIGHT 48。
- `web/src/main.jsx`：删除确认/迁移确认弹窗 portal；`useScrollDismiss` 容器豁免（分类弹层、日期弹层、标签菜单）。
- `web/src/a11y.css`：全局关闭 iOS 点击高亮。
- `web/src/ui/mistakes.css`：悬浮条投影收紧；搜索框显式行高；分类弹层显式 ink。
- `web/src/ui/detail.css`：dock 文字 `line-height: 1`。
- `web/src/ui/tokens.css`、`web/src/ui/shell.css`：顶栏高度 48/44、横幅 top 54。
- `tests/web-bridge.test.ts`：拖动期滚动锁断言。

## 兼容性与数据影响

- 错题、复习历史、答案绑定、窗口位置、标签与收藏数据结构不变。
- 插件保持正式渠道 ID，可从 beta.72/v2.3.3 原地覆盖升级。
- 迁移确认弹窗挂载点移到 body：其内部按钮类名不变，桥接行为不变。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过。
- 包内 `mnaddon.json`：正式插件 ID `marginnote.extension.mn4-answer-matcher`、正式标题「跨脑图卡片匹配」、版本 `2.3.3-beta.73`。
- Playwright 验证：分类弹层真实可滚动（255/213）且自身滚动后保持打开；聚焦新建标签输入框后派发滚动事件菜单不关闭；删除确认弹窗挂 body、z 1000 盖过标签菜单（截图）；顶栏高 48px；悬浮条控件中心线一致；27 项悬停审计全部有反馈；窄窗标签菜单完整显示。
- 未真机验证项（需 MarginNote 实机）：拖到顶部白条（滚动锁）、分隔线上深下浅（投影收紧）、点击标签栏灰条（点击高亮关闭）、输入框键盘不闪退（真实键盘）、悬浮条控件视觉居中（PingFang 行盒）。

## 未验证限制

- 「全部分类下拉默认蓝字」未能复现（桌面计算色为墨色/灰阶），已按规范显式上墨色；若真机仍见蓝字请提供截图。
- 拖动期滚动锁依赖 `scrollView.scrollEnabled` 经 JSB 可写；如真机白条仍在，请反馈运行日志。
