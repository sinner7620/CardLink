# note-navigation.ts — 定位原题与运行日志

## 职责

定位原题状态机；运行日志环形缓冲（2000 条）与导出；`captureDiagnosticError` 统一异常捕获；`maskText` 隐私脱敏。目标学习集从原卡 `note.notebookId` 读取，成功以 focus、visibleFocus 或脑图选中项为准。

## 边界

- 跨学习集只派发一次官方 `marginnote4app://note/...` 链接，并持久化 pending 供 `notebookWillOpen` 接力。
- 官方 focus 未落地后先读取同步开关：明确关闭时直接返回“请检查开关”的失败原因；开关开启或状态未知时才尝试恢复 UIStatus/选择。同步状态不作为成功判据。
- 日志只在调试导出时落盘；写盘后直接打开系统保存面板。

## 验收

跳转成功、等待、超时和不存在反馈明确；连续点击不会制造多链接队列；日志含桥接观测与分段耗时。
