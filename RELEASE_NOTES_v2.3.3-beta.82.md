# v2.3.3-beta.82

基线：beta.81。按外部根因分析（RTF 报告）对"面板拖到窗口顶部顶栏下移白条"做根源修复：采纳报告方案 1 + 方案 2，并**移除 beta.73/75 加入的全部补偿式补丁**。

## 根因（报告结论，与源码注释互证）

v61 时代浮窗挂在 `study.view` 下且位置受 clamp，顶部 y=0 只是学习视图顶部，UIWebView 不会进入 UIWindow 顶部安全区，UIKit 无从调整 scrollView 的 inset/contentOffset，旧版 UIWebView 对 `position: fixed` 的错误锚定不会触发。UIWindow 宿主 + 取消位置限制后，浮窗可被拖到窗口顶（y=0 甚至负值），UIKit 在后续布局轮次调整 inset/contentOffset 使 contentOffset 短暂为负，fixed 顶栏被锚到偏下位置，露出错题页纯白根背景（白条）。beta.73/75 的补偿链（scrollEnabled 锁、拖动逐帧 offset 清零、layoutIfNeeded + `window.scrollTo` 重锚）存在竞态：补偿执行早于 UIKit 最终布局，且 offset 已为 0 时 scrollTo 不产生滚动事件、不会触发重锚。

## 根源修复（方案 1 + 方案 2，无补偿链）

1. **方案 1（结构性预防）**：`clampFrameTop` 只约束浮窗**顶边**不得越入 UIWindow 安全区（`window.safeAreaInsets.top`，读取失败回退 20pt）——浮窗不进安全区，UIKit 的 inset/contentOffset 调整无从发生。左右与下边保持完全自由拖动，尺寸逻辑不变；恢复会话位置时同样经顶边约束。
2. **方案 2（构造性免疫）**：顶栏 `position: fixed` → **`absolute`**。根 UIWebView 从不滚动（滚动全部在内层列表：`.mistakeList`/`.reviewPage` 等，根容器 overflow hidden），absolute 顶栏钉在内容区顶部与 fixed 视觉等价，但完全绕开旧版 UIWebView 的 fixed 重锚定缺陷——即使将来出现 inset 扰动，顶栏也不会错位。
3. **移除补偿补丁**：`scrollEnabled` 拖动锁、拖动逐帧 `lockWebViewRootScroll`、`settleWebViewRootScroll`（layoutIfNeeded + 清零 + scrollTo 重锚）及 `reanchorWebViewFixedElements` 全部删除；拖动结束恢复为既有的单次 `lockWebViewRootScroll`（橡胶带抑制与 contentSize 同步，属基础设施非补丁）。面板落定瞬间的 `scrollTo` 派生滚动事件也随之消失，弹层不再被误关。

## 影响文件

`rails-native/WebPanelController.js`、`web/src/ui/shell.css`、`tests/web-bridge.test.ts`（断言改为顶边约束存在、补偿链不存在）、`tests/plugin-events.test.ts`（ensureLayout 桩参数回退为 `lockWebViewRootScroll`）、`package.json`（版本号）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。行为变化：浮窗顶边最低停在窗口安全区顶部（约状态栏高度），左右/下方拖动与尺寸调整完全自由——与 v61 的防 bug 边界一致，但保留独立浮窗架构。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.82.mnaddon`，已拷贝至 `E:\iCloudDrive\同步文件夹\`（SHA-256 见变更记录）。
- Playwright：topBar 计算样式 `absolute`、y=0 恒定；错题本侧栏滚动、待复习页滚动后顶栏 y 仍为 0，渲染与 fixed 无差异（截图 `output/playwright/b82-absolute-topbar.png`）。

## 未验证限制（必须真机）

- 拖浮窗至窗口最顶部：顶栏应始终贴住面板顶边、无白条、底部不裁切；松手、切学习集返回、重启后同样保持。
- 安全区高度来自 `window.safeAreaInsets`，读取失败回退 20pt——如真机安全区更大且仍见白条，请反馈，我将改为经桥读取的显式数值。
