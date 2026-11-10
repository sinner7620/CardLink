# index-store.ts — 索引快照存储
## 职责
快照按学习集落 Application.cachePath 文件；writeTextFile 无返回值故回读校验；旧 NSUserDefaults 快照读到即迁移并置空旧键；损坏/不可用回退旧存储。
## 验收
迁移/回退/回读校验三行为有专项测试。
索引项新增 `pathOrder: "root-first"`；缺失标记的旧 pathTitles 在读取时复制倒序，新写入带标记。已有索引无需丢弃重建，不改变答案身份和匹配规则。
