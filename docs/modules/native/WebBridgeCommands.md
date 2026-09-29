# WebBridgeCommands.js — 面板命令层与 PDF 管线
## 职责
面板命令 dispatch（closePanel/pdfTaskStatus/pdfTaskCancel 先行，其余进 rails-core）；exportMistakes/previewMistakeExport 的 renderPdf 拦截 → 隐藏 webview 渲染 → html2canvas+jsPDF → 分块回传；PDF 页边距 56pt 整页合成；任务式导出的任务表与取消。
## 边界
- 导出任务式受理（立即应答 taskId），预览保持原同步行为
- 90–600s 渲染超时按题数放宽
## 验收
大范围导出不超时；取消任务丢弃产物；页边距一致。