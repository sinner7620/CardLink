# v2.3.3-beta.101

基线：beta.100。修复 AI 分析"错题内容均无法读取"的系统性根因。

## 根因

`MN.db.getNoteById` 只覆盖**当前打开的学习集**。AI 按科目批量分析针对绑定学习集，用户当前打开的往往不是题目所在学习集——此时每一道题的原题卡片都取不到，逐条抛"原题卡片不存在或尚未同步"，全部计入不可用，最终报"错题内容均无法读取"。答案卡片渲染（`answerCardHtml`）有同样的问题。此前逐题 `catch { unavailable++ }` 把失败原因静默吞掉，用户与开发者都看不到真实原因。

仓库内早有正确范式：`refreshIndex` 取答案学习集卡片用的是 `notebookNotes(MN.db.getNotebookById(id))`；`mistake-store`/`index-store` 的失败也都有可见处理。

## 修复

- `src/mistake-manager.ts`：
  - 引入作用域感知取卡解析（`ScopedNoteResolver`）：先查当前库，未命中再按学习集建立一次性 id→卡片映射（`notebookNotes` 同源模式），映射在读取器生命周期内缓存，一次批量分析每学习集至多构建一遍。
  - `mistakeContentById` 升级为 `createMistakeContentReader()` 批量读取器；原题、子卡片/链接卡片、答案卡片的解析全部走同一映射。
  - `answerCandidatesForRecord` / `questionHtml` 接受解析器注入；`mistakeDetailById` 等既有界面路径默认行为不变。
- `src/matcher.ts`：`answerCardHtml` 增加可选 `resolveNote` 注入（默认仍为当前库，既有调用方不受影响）。
- `src/ai-subsystem.ts`：分析循环改用读取器；失败原因按消息聚合计数，"错题内容均无法读取"报错附带 TOP 原因（如 `原题卡片不存在或尚未同步 ×120`）；报告 `limitations` 同步注明内容不可用数量与原因。

## 验证

- TypeScript 检查通过；自动化测试 205/205（新增跨学习集读取器与失败原因聚合断言）。
- `pnpm build` 通过；源包与 iCloud 交付副本 SHA-256 一致：`4c54e0670e98c041b04d55d582e676b75483a0adbedb2c6a510266a04deac1cc`。

## 未验证

- 真机复测：在不打开题目学习集的状态下对科目生成总结，应能正常读取内容并出报告；部分卡片确已删除时，报告 limitations 应列出原因与数量。
