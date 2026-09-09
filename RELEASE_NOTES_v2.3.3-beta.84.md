# v2.3.3-beta.84

基线：beta.83。按外部方案（RTF）**一次性完成滚动架构归一重构**，并修复设置页三处布局问题。

## 滚动架构归一（方案四步全部落地）

职责划分自此固定：**原生层只管窗口几何（位置/尺寸/拖动/显隐）；Web 层自持全部滚动与 UI 坐标系。**

1. **布局**：`.shell`/`main` 改为 flex 纵列；顶栏成为普通文档流元素（`flex: 0 0 auto`，不再 fixed/absolute）；页面 section `flex: 1 1 auto; min-height: 0`，自持滚动（`overflow: auto`）。删除 `padding-top + height: 100vh`、`calc(100vh - 112px/55px)`、`.mistakeWorkspace height: 100vh` 等旧高度体系。
2. **fixed 全量清理**：loading 进度线、定位横幅、刷新转圈、dataStreamStatus、删除标签确认遮罩、迁移确认遮罩、分类/日期弹层、标签菜单——全部 `fixed → absolute`（portal 弹层挂 body，body 为 `fixed inset 0` 的稳定坐标系，视口坐标不变，JS 零改动）。项目内 `position: fixed` 仅剩 html/body 根容器本身。
3. **原生补偿退役**：`lockWebViewRootScroll` 整个删除（含拖动结束/显示/布局回调/加载完成/缩放结束的全部调用点）；`resizing` 标志（仅被它消费）删除。setup 初始化一次性禁滚：`scrollEnabled = false` + bounce 禁用 + inset 清零 + `contentInsetAdjustmentBehavior = 2` + `automaticallyAdjustsScrollViewInsets = false`——**只此一处，之后任何拖动/布局路径不再触碰滚动状态**。
4. 拖动路径收敛为纯几何：改 frame → 结束 `saveFrame`。`clampFrameTop`（顶边安全区约束，beta.82）保留——它是 UX 边界而非滚动补偿。

## 设置页修复

- **错题分类说明恢复原样式**：三列同行布局（等级 | 描述 | 天数编辑器）、`min-height: 72px`，撤掉 beta.80 的两行改版。
- **插件大类恢复到左列下方**：右列仅保留错题分类说明；联通测试结果与调试功能随插件回左列。
- **三个设置块宽度一致**：根因是单列断点内 flex 沿用 base 层的 `align-items: start`（按内容宽度收缩）；显式 `align-items: stretch`。单列断点 800 → 940，避免 801–920px 区间右列 430px 下限顶住导致左右列宽度不一。

## 影响文件

`rails-native/WebPanelController.js`、`web/src/main.jsx`、`web/src/ui/{shell,controls,mistakes,settings}.css`、`tests/web-bridge.test.ts`、`tests/plugin-events.test.ts`、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。架构约定：今后新增覆盖层一律 absolute 锚 shell/body，新增页面一律 flex + min-height:0 自持滚动。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过（断言同步新架构：shell/main flex 化、初始化仅一次禁滚、无 settle/reanchor/scrollTo、顶栏横幅 absolute）。
- Playwright 逐页回归：总览/错题本/待复习/设置四页内层滚动正常（scrollTop 120/46/120/120）、顶栏 y 恒为 0；详情打开正常；删除确认遮罩 absolute 从 (0,0) 全屏覆盖（980×660）；分类弹层 absolute 且在视口内；设置页 860px 单列三块 824px 等宽、1180px 两列左列 588 等宽、guide 卡三列 72px；截图 `output/playwright/b84-mistakes.png`、`b84-settings-wide.png`、`b84-popover.png`。

## 未验证限制（必须真机）

- 拖窗至窗口顶部及周边：无白条、顶栏贴合、底部不裁切（本版根滚动禁滚后理论上结构性不可能，仍需实机确认）。
- 内层列表滚动、键盘弹出 scroll-into-view、双指缩放在旧 UIWebView 上的表现。
