# 2026-09-06 — AI 内容提取跨学习集修复与失败原因聚合（v2.3.3-beta.101）

基线：beta.100。真机反馈：AI 分析报"错题内容均无法读取"。

## 根因

`MN.db.getNoteById` 只覆盖当前打开的学习集（MarginNote 每个学习集独立数据库）。按科目批量分析针对绑定学习集，当前打开的不是题目学习集时，所有原题卡片取不到 → 逐条失败 → 全部计入不可用 → 报"错题内容均无法读取"。答案卡片渲染同病。旧代码 `catch { unavailable++ }` 吞掉原因，不可诊断。

## 修复内容

1. `src/mistake-manager.ts`
   - 新增 `ScopedNoteResolver`（作用域感知取卡）：先当前库，未命中按学习集建一次性 id→卡片映射（`notebookNotes(MN.db.getNotebookById(id))`，与 `refreshIndex` 同源），映射随读取器缓存。
   - `mistakeContentById` → `createMistakeContentReader()`；原题、子卡片、答案卡片解析统一注入。
   - `questionHtml`/`answerCandidatesForRecord` 接受解析器注入；`mistakeDetailById` 默认行为不变。
2. `src/matcher.ts`：`answerCardHtml` 可选 `resolveNote` 注入，默认当前库。
3. `src/ai-subsystem.ts`：分析循环改用读取器；失败原因按消息聚合，终止错误与报告 `limitations` 均附带 TOP 原因与数量。

## 受影响文件

`src/mistake-manager.ts`、`src/matcher.ts`、`src/ai-subsystem.ts`、`tests/ai-subsystem.test.ts`、`package.json`（版本号）。

## 兼容性与数据影响

不改存储键与桥接协议；`answerCardHtml` 新参数可选，既有调用方（plugin 展示路径）行为不变。AI 批量读取继续对 mistakes.v2 零写入。

## 验证

- `pnpm check` 通过；`pnpm test` 205/205。
- `pnpm build` 通过；源包与 iCloud 交付副本 SHA-256 一致（见 RELEASE_NOTES_v2.3.3-beta.101.md）。

## 未验证限制

- 真机复测跨学习集批量提取（题目学习集未打开时生成总结）与部分失败时报告 limitations 的原因展示。
