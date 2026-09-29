# v2.3.3-beta.75：面板拖顶白条根治——UIWebView fixed 元素重锚

日期：2026-09-05。基线：beta.74（正式渠道，版本号 2.3.3-beta.75）。范围：真机反馈"拖到顶部顶栏仍延伸白条"。

## 根因修正认知

beta.73 的 scrollEnabled 滚动锁与既有的 inset/offset 清零没有消除白条，说明病灶不在"offset 被挪动"本身，而在 **UIWebView 对 `position: fixed` 元素的锚定机制**：fixed 顶栏只在滚动事件时重新锚定。拖到顶部时 UIKit 把 contentOffset 挪成负值（顶部 inset），顶栏在该瞬间被布局到偏下位置；之后程序性清零 offset 不会触发重锚，白条留存。此前的滚动锁只能减少 offset 被挪动的机会，既挡不住 UIKit 的自动 inset 调整，也无法让已错锚的顶栏归位。

## 实现

1. `reanchorWebViewFixedElements`：`evaluateJavaScript("window.scrollTo&&window.scrollTo(0,0)")`，强制 UIWebView 按清零后的 offset 重锚 fixed 顶栏（webReady 后才执行）。
2. `settleWebViewRootScroll`：`layoutIfNeeded`（让 UIKit 在新几何下先完成自动 inset/offset 调整）→ `lockWebViewRootScroll`（清零）→ 重锚。接入拖动结束、缩放结束、showPanel、跨学习集恢复、ensureLayout、webViewDidFinishLoad 六个几何落定点。
3. 拖动全程每帧 `lockWebViewRootScroll` 钉住 offset（清零 insets/offset），不给 UIKit 把 fixed 顶栏锚偏的时间窗；`scrollEnabled = false` 滚动锁保留。

## 影响文件

`rails-native/WebPanelController.js`、`tests/web-bridge.test.ts`、`tests/plugin-events.test.ts`（ensureLayout 测试桩参数跟随更名）、`package.json`、`RELEASE_NOTES_v2.3.3-beta.75.md`。

## 兼容性与数据影响

数据结构、存储键、桥接命令不变；正式渠道 ID 原地覆盖升级。面板落定瞬间的 `window.scrollTo` 会派发一次滚动事件，可能关闭正打开的下拉弹层（拖动/显示面板时弹层关闭属预期行为）。

## 验证

- `pnpm check` 通过；`pnpm test` 178/178 通过；`pnpm build` 通过，生成 `dist/mn4-answer-matcher-v2.3.3-beta.75.mnaddon`（490330 字节，SHA-256 `5B18836F01585CEDB411B4C4D055146B700D903E177F9C904AA4C8D98B38F148`），已拷贝至 `E:\iCloudDrive\同步文件夹\mn4-answer-matcher-v2.3.3-beta.75.mnaddon`，副本与原包哈希一致。
- 包内 `mnaddon.json`：正式插件 ID、正式标题、版本 `2.3.3-beta.75`。
- 测试更新：拖动全程钉住、重锚函数、完整复位链路断言；ensureLayout 桩测试跟随 `settleWebViewRootScroll` 更名。

## 未验证限制（必须真机）

桌面无 UIWebView 宿主，本项修复最终确认必须真机：拖到屏幕顶部时顶栏始终贴住面板顶边，无白条、底部不裁切；松手、切学习集返回、重启后同样保持。若仍有白条，请开调试模式导出运行日志反馈。
