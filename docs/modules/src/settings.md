# settings.ts — 插件设置
## 职责
设置读写（会话级缓存 + 原子覆盖写）；normalizeMistakeReviewCurves/自定义分类 re-export。
## 边界
- 缓存生命周期 = 场景会话；所有写入必须走 saveMatcherSettings
## 验收
高频读零存储往返。