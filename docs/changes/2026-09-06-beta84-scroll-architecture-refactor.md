# v2.3.3-beta.84：滚动架构归一重构 + 设置页布局修复

日期：2026-09-06。基线：beta.83（正式渠道，版本号 2.3.3-beta.84）。范围：按外部方案一次性完成滚动架构归一（四步全落地），并修复设置页三处布局问题。

## 架构（职责自此固定）

原生层只管窗口几何（`self.view.frame = newFrame` 为终点，不再关心网页滚动/fixed/offset）；Web 层自持全部滚动与 UI 坐标系（覆盖层 absolute 锚 shell/body，页面自持滚动）。

1. **布局 flex 化**：`.shell`/`main` flex 纵列；顶栏普通文档流元素（`flex: 0 0 auto` + `position: relative`）；section `flex: 1 1 auto; min-height: 0` 自持滚动。删除 `padding-top + 100vh`、`calc(100vh - 112px/55px)`、`mistakeWorkspace 100vh` 旧高度体系。
2. **fixed 全量清理**：loading、定位横幅、刷新转圈、dataStreamStatus、两个全屏遮罩、分类/日期弹层、标签菜单 → `absolute`。portal 弹层挂 body（body 为 `fixed inset 0` 稳定坐标系），视口坐标与 body 坐标重合，JS 零改动。根因备注：beta.84 曾发现 portal 弹层仍为 fixed 的原因是**内联样式 `POPOVER_FIXED` 覆盖 CSS**——已改为 `POPOVER_ABSOLUTE`（3 处）。
3. **原生补偿退役**：`lockWebViewRootScroll` 函数与全部调用（拖动结束/显示/布局回调/加载完成/缩放结束）、`resizing` 标志删除；setup 一次性配置 `scrollEnabled = false`、bounce 禁用、inset 清零、`contentInsetAdjustmentBehavior = 2`、`automaticallyAdjustsScrollViewInsets = false`。拖动 = 改 frame + 结束存档。`clampFrameTop`（beta.82 顶边安全区约束）保留——UX 边界而非滚动补偿。
4. **验证顺序**按方案：布局 → fixed 清理 → 逐页滚动回归 → 原生删除。

## 设置页修复

- 错题分类说明恢复原样式：三列同行（等级|描述|天数编辑器）+ `min-height: 72px`，撤 beta.80 两行改版。
- 插件大类回左列下方，右列仅保留错题分类说明（联通结果与调试随插件回左列）。
- 三块宽度一致：根因 = 单列断点 flex 继承 base 层 `align-items: start`（按内容宽收缩，实测 362/276/371）；显式 `align-items: stretch`（三块等宽）。单列断点 800 → 940，消除 801–920px 区间右列 430px 下限造成的左右列宽度不一。

## 影响文件

`rails-native/WebPanelController.js`、`web/src/main.jsx`、`web/src/ui/{shell,controls,mistakes,settings}.css`、`tests/web-bridge.test.ts`、`tests/plugin-events.test.ts`、`package.json`。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。架构约定（后续评审标准）：覆盖层一律 absolute 锚 shell/body；页面一律 flex + min-height:0 自持滚动；原生不得触碰滚动状态。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.84.mnaddon`（SHA-256 `D550A41B1DC628D32F155AB2E202FE8700B087C51B7DBCAB546901D6643B9180`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.84.mnaddon`，副本与原包哈希一致。
- Playwright 逐页回归（四页滚动 + 顶栏恒 0 + 详情 + 遮罩全屏覆盖 + 弹层 absolute 视口内 + 设置等宽/guide 原样式）；截图 `output/playwright/b84-*.png`。

## 未验证限制（必须真机）

拖窗至顶部及周边的结构性验证、内层滚动/键盘 scroll-into-view/双指缩放在旧 UIWebView 的表现。
