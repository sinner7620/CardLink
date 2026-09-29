# index-store.ts — 索引快照存储
## 职责
快照按学习集落 Application.cachePath 文件；writeTextFile 无返回值故回读校验；旧 NSUserDefaults 快照读到即迁移并置空旧键；损坏/不可用回退旧存储。
## 验收
迁移/回退/回读校验三行为有专项测试。