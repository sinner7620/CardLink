# note-tree.md — 笔记本遍历
## 职责
笔记本笔记集合获取与子脑图卡片收集；对官方 notes 语义做自适应兜底（文档与实测可能不符）。

`notebookContainsNote` 用于卡片菜单的单卡归属校验：优先比较卡片 `notebookId` 与学习集 `topicId`，不一致直接拒绝；缺少归属字段时才回退到 `notebookNotes` 枚举。缺失卡片或学习集返回 false。
