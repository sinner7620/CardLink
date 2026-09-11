# v2.3.3-beta.88

基线：beta.87。处理真机反馈三项：候选下拉行点击无反应、候选长条未跟随关闭/刷新的左右侧设置、顶栏毛玻璃复原。

## 逐项根因与实现

1. **候选下拉行点击无反应（根因确认）**：JSB 控件回调传入的 sender 是新的原生代理对象，与存储在 `answerCardCandidateButtons` 里的对象**不是同一实例**，按引用 indexOf 必然落空；而行创建时又没有写入 `tag`，tag 回退也拿不到行序——两路全空，处理器静默返回。修复：创建候选行时写入 `row.tag = index`（try/catch），点击处理按 tag 定位（indexOf 作为回退保留）。
2. **候选长条未跟随侧边设置**：位置原为固定 x=106（左关闭/刷新假设）。改为跟随 `layoutAnswerCardWindowControls` 的 side：左侧布局时长条在刷新右侧（x=106）；右侧布局时长条贴在刷新按钮左侧（`refresh.x - 宽 - 8`），下拉面板同步移动。
3. **顶栏毛玻璃复原**：beta.84 的文档流布局中内容不再从顶栏下经过，blur 无从体现（观感回退为平面）。恢复为 **absolute 覆盖式**：顶栏 `position: absolute` + `backdrop-filter: blur(22px) saturate(1.8)` + 半透明底，页面 section 恢复 `padding-top`，内容从毛玻璃下滚过。白条不会复发：absolute 不依赖旧版 UIWebView 的 fixed 层重锚定，且根 UIScrollView 已永久禁滚、顶边有安全区约束，不存在触发锚定缺陷的 offset 扰动。

## 影响文件

`src/answer-card-view.ts`（候选行 tag、侧边感知布局）、`web/src/ui/shell.css`（毛玻璃顶栏）、`tests/plugin-events.test.ts`（侧边感知断言）、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。

## 验证

- `pnpm check` 通过；`pnpm test` 179/179 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.88.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright：topBar `absolute` + `blur(22px) saturate(1.8)` + 半透明底，内容区与顶栏重叠、滚动后顶栏 y=0（截图 `output/playwright/b88-frosted.png`）。

## 未验证限制（必须真机）

- 候选下拉行点击切换（tag 写入与 JSB 回调传参的实际行为）、长条在右侧布局下的位置。
- 毛玻璃在真机 UIWebView 的渲染效果。
