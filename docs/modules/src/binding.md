# binding.ts — 绑定存储
## 职责
绑定关系键值存取：笔记本级键 + scoped 键（nb::root::rootId）；getBindingForMode 回退解析；removeBindingScope 整学习集移除；answerOnlyBindingScopes 纯答案范围。
## 边界
- scoped 开启时笔记本级键仍回退生效——解除绑定须对称清键（plugin 侧实现）
## 验收
scoped/非 scoped 绑定与解除对称。