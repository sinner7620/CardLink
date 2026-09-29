# lib/mnBridge.js — 原生桥接（前端侧）
## 职责
send(command, payload)：mnaddon:// scheme + iframe + 30s 超时；大响应 65536 分块拉取；runtimeLog 前端诊断通道（超时/解析失败/全局异常写入原生环形缓冲）；window.onerror/unhandledrejection 捕获。原生错误可为历史 string 或 `{ code?, message }`，调用页面继续只显示 `reason.message`，无需理解错误码。
## 边界
- 长任务（PDF 导出）已任务化，30s 超时只影响普通命令
- 日志失败静默不影响主流程
## 验收
超时/解析失败进运行日志；分块拉取对上层透明。
