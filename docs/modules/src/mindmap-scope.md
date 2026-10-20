# mindmap-scope.ts — 脑图作用域
## 职责
节点标识、脑图根节点解析、isInMindMap 归属判定。

`readMindMapBranch` 对具体脑图按根 ID 读取 NodeNote 子树，保留子节点顺序并按实际节点 ID 去重。主脑图、根缺失/跨学习集、分组别名根、根无可读层级或遍历异常时返回 undefined，由调用方保留全学习集路径；不会以部分子树替代完整快照。
