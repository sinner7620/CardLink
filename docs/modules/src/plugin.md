# plugin.ts — 交互动作层
## 职责
用户交互动作：菜单（标签→动作映射表）、工具栏点击、绑定/解绑（对称清键）、configureAnswerMatching、答案卡诊断（调试门控）、runSafely 统一错误 HUD。
## 关键重构
- resolveAnswerLookupContext：查找/工作台共用上下文装配
- pickFromList：Mac/iPad 选择器双分支收敛
## 验收
菜单 12 项动作与标签一致；解绑对称（scoped 回退键一并清除）。