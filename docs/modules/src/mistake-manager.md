# mistake-manager.ts — 错题管理核心
## 职责
错题全生命周期业务中枢：标记、复习推算、改级、分类、恢复扫描、工作台数据装配、提醒轮询。
## 关键导出
- markQuestionAsMistake / markQuestionsAsMistakes：单题与批量标记（统一走 reviewMistake 推算）
- reviewMistakeById / changeMistakeLevelById / reviewMistakesByIds / resumeMistakeReviewById
- repairAndOrganizeMistakes：刷新错题分类索引（手动入口，内含全量标签恢复 + beta.12 反向记录修复）
- mistakeWorkbenchData / mistakeDetailById：面板数据装配（分段耗时已埋点）。详情可选 `content: "question" | "answers" | "all"`，默认 all 保留原调用行为；question 跳过答案工作并返回 answerStatus=deferred；answers 不生成原题 HTML。两种局部读取仍同步原卡元数据，日志包含 content。
- recoverMistakesFromTags：全量标签恢复（仅手动）
## 依赖
mistake-store、mistake-domain、mistake-tags、note-navigation（写入层/日志）、matcher、settings、note-tree
## 边界
- 标签写入统一经 commitSourceTagTasks（撤销组锚定源笔记本）
- 批量标记直接使用当前选卡，不再按锚点脑图、答案专用范围、父卡颜色或答案索引过滤；单卡场景菜单仍沿用原有校验。按源卡片 ID 去重，在同一学习集的一次撤销组内逐卡写入并回读。仅成功项保存错题记录、复测历史与计划；失败项保留旧记录或不创建新记录，单卡异常不阻断其他项，结果返回实际新增/更新/失败数。
- 到期口径：日历日（今天 24 点前），与全插件统一
- 恢复扫描只增不删不改；删除由 syncManualTagsFromSource 的取消判定负责
- 答案读取将 indexNotReady 错误码和旧版索引关键字错误标记为 index-missing；交互桥接层提供刷新/取消/换绑弹窗。AI 只读提取和导出不弹交互窗口。
## 验收
详情读取发现原卡标题变化时保存新标题并推进 updatedAt，使列表缓存失效；前端打开详情或刷新已选详情时将返回记录合并到对应列表项。普通列表刷新仍不逐题扫描原卡。

原题渲染、答案查找、单卡菜单的答案过滤与复习遮盖共用 `usesSubcardAnswers`，只依据子卡/混合模式及题目颜色判定；混合绑定的答案目标位于其他脑图或学习集时，原题预览仍省略直接子卡答案。

读取原卡所属脑图时优先采用其 `childMindMap`，仅在无法直接判断时惰性读取子脑图集合，避免普通子脑图题目重启后的首次打开触发全学习集扫描。主脑图卡片和无直接归属的子脑图根仍保留候选扫描，批处理内继续复用原有缓存；元数据和标签同步行为不变。

待复习 `mistakeQuestion` 轻量响应还可携带 `{recordId, sourceTitle, updatedAt}` 标题补丁；读取原题或答案后同步到 App 共享记录，因此总览、错题本、待复习和导出选题使用同一标题。AI 只读内容读取器保持无记录写入、无预览绑定手写追加；已生成报告和导出文件不反向改写。

标记/复习/改级/取消在"面板打开+学习集已关闭"场景正确；恢复扫描只补缺失；纯答案学习集豁免。

用户主动单条或批量取消时，原卡查询正常返回空值的记录直接清理，不要求标签写入，也不阻塞同学习集其他记录。现存原卡仍要求标签清除验证成功；查询异常不视为原卡删除。批量结果的 changed/records 包含成功清理的缺失原卡记录，missing 仅统计不存在的错题记录 ID。
