# matcher.ts — 答案索引与查找
## 职责
答案脑图索引构建（refreshIndex，分段耗时埋点）、多策略查找、快照存取（经 index-store）、clearIndex。
## 边界
- 索引快照存 cachePath 文件；refreshIndex 每 40 条让步
- 具体脑图重建优先 `readMindMapBranch` 局部读取，再按原 isInMindMap 过滤；不可局部读取时使用 notebookNotes。主脑图及学习集级索引保留完整枚举。
## 验收
重启后快照恢复命中；失效引用/异常卡片计数进 HUD。
