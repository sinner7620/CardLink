# v2.3.3-beta.82：拖顶白条根源修复——安全区顶边约束 + 顶栏脱离 fixed

日期：2026-09-06。基线：beta.81（正式渠道，版本号 2.3.3-beta.82）。范围：按外部根因分析报告实施方案 1 + 方案 2，移除 beta.73/75 的补偿式补丁。

## 根因

v61 浮窗挂 `study.view` 且位置受 clamp，顶部无法进入 UIWindow 安全区，UIKit 无从调整 UIWebView.scrollView 的 inset/contentOffset，旧版 UIWebView 的 `position: fixed` 错误锚定不触发。UIWindow 宿主 + 取消位置限制后浮窗可拖至窗口顶，UIKit 后续布局轮次使 contentOffset 短暂为负，fixed 顶栏被锚到偏下，露出错题页纯白根背景（白条）。补偿链存在双重缺陷：补偿执行早于 UIKit 最终布局（竞态）；offset 已为 0 时 `window.scrollTo(0,0)` 不产生滚动事件、无法触发重锚。

## 根源修复

1. **方案 1（预防）**：`safeAreaTop`（`window.safeAreaInsets.top`，回退 20pt）+ `clampFrameTop`——拖动与会话恢复仅约束浮窗**顶边**不越入安全区，左右/下方自由，尺寸逻辑不变。
2. **方案 2（免疫）**：顶栏 `position: fixed` → `absolute`（根 WebView 永不滚动，内层列表滚动），从构造上绕开 fixed 重锚定缺陷。
3. **移除补偿链**：scrollEnabled 拖动锁、拖动逐帧 offset 清零、`settleWebViewRootScroll`/`reanchorWebViewFixedElements`（layoutIfNeeded + scrollTo）全部删除；拖动结束恢复单次 `lockWebViewRootScroll`（基础设施）。副作用修正：面板落定不再派发 scrollTo，弹层不会被误关。

## 影响文件

`rails-native/WebPanelController.js`、`web/src/ui/shell.css`、`tests/web-bridge.test.ts`、`tests/plugin-events.test.ts`、`package.json`、`RELEASE_NOTES_v2.3.3-beta.82.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。行为变化：浮窗顶边最低停在窗口安全区顶部（约状态栏高度），其余方向拖动完全自由。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.82.mnaddon`（SHA-256 `3772AC24076043C52BE8B8A61396DEB290EBCE3C91C0424EF0B003D0D827CCC6`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.82.mnaddon`，副本与原包哈希一致。
- Playwright：topBar `position: absolute`、y=0 恒定；错题本侧栏与待复习页内层滚动后顶栏 y 不变，渲染与 fixed 无差异（截图 `output/playwright/b82-absolute-topbar.png`）。

## 未验证限制（必须真机）

拖浮窗至窗口最顶部验证无白条、底部不裁切；松手/切学习集/重启后保持。安全区读取失败回退 20pt——若真机仍见白条请反馈，改为桥显式数值。
