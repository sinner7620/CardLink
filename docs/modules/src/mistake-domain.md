# mistake-domain.ts — 错题领域模型（纯函数）
## 职责
复习推算与判定唯一真源：reviewMistake（改档重置/同档推进/掌握二次确认结束）、isDue（日历口径）、排序比较、manualCategories 推导、REVIEW_CURVES 单一来源。
## 边界
- 纯函数无 MN API 依赖，可独立测试
- 到期口径：本地今天 24 点前（含已逾期），全插件统一
## 验收
日历口径四态测试；同档推进与改档重置序列正确。