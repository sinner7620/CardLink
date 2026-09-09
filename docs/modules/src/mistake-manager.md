# mistake-manager.ts — 错题管理核心
## 职责
错题全生命周期业务中枢：标记、复习推算、改级、分类、恢复扫描、工作台数据装配、提醒轮询。
## 关键导出
- markQuestionAsMistake / markQuestionsAsMistakes：单题与批量标记（统一走 reviewMistake 推算）
- reviewMistakeById / changeMistakeLevelById / reviewMistakesByIds / resumeMistakeReviewById
- repairAndOrganizeMistakes：刷新错题分类索引（手动入口，内含全量标签恢复 + beta.12 反向记录修复）
- mistakeWorkbenchData / mistakeDetailById：面板数据装配（分段耗时已埋点）
- recoverMistakesFromTags：全量标签恢复（仅手动）
## 依赖
mistake-store、mistake-domain、mistake-tags、note-navigation（写入层/日志）、matcher、settings、note-tree
## 边界
- 标签写入统一经 commitSourceTagTasks（撤销组锚定源笔记本）
- 到期口径：日历日（今天 24 点前），与全插件统一
- 恢复扫描只增不删不改；删除由 syncManualTagsFromSource 的取消判定负责
## 验收
标记/复习/改级/取消在"面板打开+学习集已关闭"场景正确；恢复扫描只补缺失；纯答案学习集豁免。