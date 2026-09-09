# CardPreview — 题目与答案的共享预览入口

## 职责

web/src/CardPreview.jsx管理iframe装载、缩放工具同步和事件清理。src/card-preview.ts的mountCardPreview拥有内容布局、缩放范围、滚动锚点；src/pinch-zoom.ts拥有单指/双指/gesture仲裁。renderCardHtml序列化同一控制器进入原生答案WebView。

## 边界

同一文档只允许一个控制器，禁止父iframe重复接管body缩放。所有交互预览60%—300%，单指原生滚动；导出预览是静态纸张布局，不绑定手势。原题首次高度缓存保留，列表架构改造待审批。

## 验收

tests/card-preview.test.ts覆盖幂等、清理、单指与双指、打包序列化、浅色与手写DPR比例；浏览器验证缩放时外层答案窗口尺寸不变。
