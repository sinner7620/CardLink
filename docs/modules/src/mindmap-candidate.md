# mindmap-candidate.md — 子脑图候选
## 职责
收集学习集内可作为答案脑图的候选（排除当前题卡所在脑图）。

`mindMapScopeIdForNote` 和 `noteBelongsToMindMapScope` 的已知子脑图集合兼容 Iterable，也接受惰性回调。卡片自身的 `childMindMap` 足以确定归属时，不调用回调；无此字段的子脑图根卡片仍需候选集合识别，不能直接当成主脑图。按具体子脑图验证归属不需要枚举其他子脑图。
