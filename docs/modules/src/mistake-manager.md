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
详情读取发现原卡标题变化时保存新标题并推进 updatedAt，使列表缓存失效；前端打开详情或刷新已选详情时将返回记录合并到对应列表项。普通列表刷新仍不逐题扫描原卡。

待复习 `mistakeQuestion` 轻量响应还可携带 `{recordId, sourceTitle, updatedAt}` 标题补丁；读取原题或答案后同步到 App 共享记录，因此总览、错题本、待复习和导出选题使用同一标题。AI 只读内容读取器保持无记录写入、无预览绑定手写追加；已生成报告和导出文件不反向改写。

标记/复习/改级/取消在"面板打开+学习集已关闭"场景正确；恢复扫描只补缺失；纯答案学习集豁免。

用户主动单条或批量取消时，原卡查询正常返回空值的记录直接清理，不要求标签写入，也不阻塞同学习集其他记录。现存原卡仍要求标签清除验证成功；查询异常不视为原卡删除。批量结果的 changed/records 包含成功清理的缺失原卡记录，missing 仅统计不存在的错题记录 ID。
