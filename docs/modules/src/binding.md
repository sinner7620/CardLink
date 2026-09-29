# binding.ts — 绑定存储
## 职责
绑定关系键值存取：笔记本级键 + scoped 键（nb::root::rootId）；getBindingForMode 回退解析；removeBindingScope 整学习集移除；answerOnlyBindingScopes 纯答案范围。
## 边界
- scoped 开启时笔记本级键仍回退生效——解除绑定须对称清键（plugin 侧实现）
- 新字段 `selectionMode`（混合/指定）、`designatedAnswer`（答案脑图/直接子卡片）和 `questionColors` 按绑定关系保存。旧绑定没有这些字段时默认指定答案脑图，原匹配方式保持不变。仅指定子卡时不把保留的答案脑图目标当作活动索引或纯答案范围。
- 题目颜色从当前脑图单张已选卡的 `colorIndex` 添加，按绑定键和脑图范围校验；删除直接更新该绑定的颜色数组，不枚举学习集卡片。
## 验收
scoped/非 scoped 绑定与解除对称。
