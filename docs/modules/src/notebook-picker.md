# notebook-picker.md — 学习集选择器
## 职责
系统 select 封装（chooseNotebook，0.08s 延迟避让导航回调）；兼容 no-op 注册。
## 边界
- 长标题字节截断问题已随系统选择器重构消失