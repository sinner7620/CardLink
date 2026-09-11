# session-state.ts — 会话退出状态
## 职责
setPluginSuspended/isPluginSuspended：用户取消迁移后的会话级退出——抑制自动更新检查与遥测。
## 验收
挂起状态零外呼（行为测试覆盖）。