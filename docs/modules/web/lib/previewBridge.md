# lib/previewBridge.js — 浏览器预览 mock
## 职责
isBrowserPreview 时替代 mnBridge：内置 mock 错题数据与全部命令的预览实现（含联通测试/任务式导出模拟）。
## 边界
- 未知命令曾静默 {preview:true}（已知取舍）
- 预览数据为硬编码示例，非真实库
## 验收
本地预览页全动线可走通。