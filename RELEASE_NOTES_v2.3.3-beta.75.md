# v2.3.3-beta.75

基线：beta.74。处理真机反馈：面板拖到屏幕顶部时顶栏上方仍出现白条——beta.73 的滚动锁没有治到本源，本版按 UIWebView fixed 元素锚定机制重新根治。

## 根因（修正认知）

截图显示白条区域是页面包的背景，`position: fixed` 的顶栏整体被布局到面板顶边之下。这是 UIWebView 的机制性问题：**fixed 元素只在滚动事件时重新锚定**。面板拖到顶部时 UIKit 把 scrollView 的 contentOffset 挪成负值（顶部 inset），顶栏恰在该瞬间被布局到偏下位置；beta.73/74 虽然在松手后把 offset 清零，但**程序性修改 offset 不会触发 UIWebView 重锚 fixed 元素**，白条因此留存。beta.73 的 scrollEnabled=false 只能减少 offset 被挪动的机会，挡不住 UIKit 的自动 inset 调整，也不能让已经错锚的顶栏归位。

## 实现

- **拖动全程钉住根滚动**：`handleHeaderPan` 每帧设置 frame 后立即 `lockWebViewRootScroll`（清零 inset 与 contentOffset），顶栏在拖动全程贴住面板顶边，不给 UIKit 留出把 fixed 元素锚偏的时间窗。
- **落定后完整复位 `settleWebViewRootScroll`**：`layoutIfNeeded`（让 UIKit 在新几何下完成自动调整）→ `lockWebViewRootScroll`（清零）→ `reanchorWebViewFixedElements`（evaluateJavaScript 执行 `window.scrollTo(0,0)`，强制 UIWebView 按清零后的 offset 重锚 fixed 顶栏）。
- 接入落定点：面板拖动结束、缩放结束、面板显示（showPanel）、跨学习集恢复、宿主布局变化（ensureLayout）、页面载入完成（webViewDidFinishLoad）。
- `tests/web-bridge.test.ts`：断言拖动全程钉住、重锚函数与完整复位链路。

## 影响文件

`rails-native/WebPanelController.js`、`tests/plugin-events.test.ts`（ensureLayout 测试桩跟随函数更名）、`tests/web-bridge.test.ts`、`package.json`（版本号）、`RELEASE_NOTES_v2.3.3-beta.75.md`（新增）。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。`window.scrollTo(0,0)` 会在面板落定瞬间派发一次滚动事件，可能关闭正打开的下拉弹层（拖动/显示面板时弹层本应关闭，属预期）。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.75.mnaddon`。
- 包内 `mnaddon.json`：正式插件 ID、正式标题、版本 `2.3.3-beta.75`。
- 桌面端无 UIWebView 宿主，本项修复的最终确认必须真机：拖到屏幕顶部，顶栏应始终贴住面板顶边，无白条、底部不裁切；松手、切学习集回来、重启后同样保持。
