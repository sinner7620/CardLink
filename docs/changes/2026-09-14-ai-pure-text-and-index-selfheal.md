# 2026-09-14 AI 纯文字题丢弃修复与答案索引失效机制

## 背景与目的

代码审查（v2.4.2）发现两类问题，本次任务一并处理：

1. **高危 bug**：`runAnalysis` 构造分析条目时直接取 `prepared!.questionText`，而纯文字题（`needsOCR=false`）未做过 OCR 准备时 `prepared` 为 undefined，TypeError 被逐题 catch 吞掉、计为“内容不可用”，整题被静默丢弃。第 684 行已按正确口径算出 `question` 变量但从未使用（死变量即证据），与 `aiPreviewAnalysis` 允许未准备纯文字题的口径不一致。
2. **索引一致性缺口**：插件没有任何数据变更观察器（MN4 事件面仅有弹窗事件，无可订阅的 DB 变更通知），答案索引快照对答案卡片的改名、删除、新增完全无感知：
   - 匹配不到时只能靠弹窗引导用户手动“刷新索引后重试”；
   - 命中已删除卡片时错误暴露在渲染阶段（`answerCardHtml` 抛“答案卡片已不存在”），远离根因；
   - `notebookShapeCache`（note-tree.ts）首次探测若发生在学习集未同步完整时，错误形态被永久缓存且无失效入口；
   - 空索引快照写得进（`"[]"`）读不回（`loadStoredIndex` 拒绝空数组），空答案范围每次查找误报“索引尚未建立”。

## 实现内容

### 修复 1：AI 纯文字题

- `src/ai-input.ts` 新增 `analysisQuestionText(input, prepared?)`：`needsOCR` 时取 OCR 结果，否则取原生文字，作为 runAnalysis 与 aiPreviewAnalysis 的统一题干口径。
- `src/ai-subsystem.ts` `runAnalysis` 改用该函数（原来 `prepared!.questionText` 的位置改用统一口径），未准备的纯文字题正常进入分析。

### 修复 2：索引失效治理（失效信号检测 + 仅手动重建）

MN4 无可订阅的笔记变更事件（typings 中无 DB observer）。**经用户决策，不引入任何自动重建**：检测到失效信号时只改善呈现，重建一律由用户手动触发（菜单“刷新答案索引”、或空匹配弹窗中的“刷新索引后重试”）。

- `src/plugin.ts`
  - `answerWorkbenchData`（同步桥接命令，本就不做整库重建）：以 `answerNoteExists` 剔除已删除的答案卡，避免一张失效卡片令整个 candidates 组装（含卡片 HTML 渲染）中断；这只是不渲染失效条目，不触发扫描。
  - `findCurrentAnswer` 保持原有交互：空匹配时弹窗引导“刷新索引后重试”；命中已删除卡片的渲染错误继续经由 `describeError` 呈现“目标内容不存在或已被删除，请刷新后重试”。
- `src/matcher.ts`
  - `refreshIndex` 重建入口先 `clearNotebookShapeCache()` 再重新探测，纠正“学习集未同步完整时首次探测结果被永久缓存”的问题（仅作用于手动重建路径）。
  - `restoreIndex` 接受空数组快照：“已建立但 0 张卡”不再被误判为“尚未建立”。
- `src/index-store.ts`：`loadStoredIndex` 接受空数组文件快照（与 `saveStoredIndex` 的 `"[]"` 写入对称）。
- `src/note-tree.ts`：新增 `clearNotebookShapeCache()`。

曾实现过“检测到失效信号即自动重建＋10 秒节流”的自愈方案，按用户决策整体移除（`rebuildIndexAndRematch`、`autoRebuildAllowed` 均不存在），并以源码守卫测试固化“查找路径不得出现隐式重建、refreshIndex 仅可出现在手动确认弹窗之后”。

## 受影响文件

`src/ai-input.ts`、`src/ai-subsystem.ts`、`src/plugin.ts`、`src/matcher.ts`、`src/index-store.ts`、`src/note-tree.ts`；测试 `tests/ai-input-behavior.test.ts`、`tests/ai-subsystem.test.ts`、`tests/plugin-events.test.ts`、`tests/index-store-behavior.test.ts`。

## 兼容与数据影响

- 索引快照文件格式不变；空数组快照从“不可读”变为有效值，旧版本数据可正常读取。
- 重建索引只由用户手动触发（菜单入口或空匹配弹窗确认），无隐式全量扫描；工作台的失效卡剔除只是渲染过滤，每张候选卡恰好是渲染本就要做的一次 `getNoteById` 查询。
- 解绑后的持久化快照/updated-at 残留、绑定键垃圾回收不在本次范围（原审查 M6/功能缺口 3）。

## 验证

- `pnpm check` 通过（tsc --noEmit 无输出）。
- `pnpm test` 通过：262/262（原 257 + 新增 5）。
  - 行为测试“纯文字题未做 OCR 准备也能直接分析”（`ai-input-behavior.test.ts`，走真实 bridge 与请求组装，仅 mock 原生边界）：临时还原旧 `ai-subsystem.ts` 后该测试失败（整题丢弃 → 任务 failed），确认可捕获原 bug；修复后通过。
  - 行为测试“空索引快照读写”（`index-store-behavior.test.ts`）。
  - 源码形状守卫：仅手动重建策略（`plugin-events.test.ts`：查找路径无隐式重建入口、refreshIndex 仅在手动确认之后）、题干统一口径（`ai-subsystem.test.ts`）。
- 未做 MarginNote 真机验证：手动重建时形态缓存重置、真机上 `MN.db.getNoteById` 的实际开销需真机确认。

## 交付记录（v2.4.2 同版本替换）

- 经作者明确授权（“保持并生成2.4.2”），将本任务修复并入 v2.4.2 做同版本替换，替代 2026-09-14 00:09 首版构建（旧哈希 `4e77b8df…7ac24f`）。该同版本替换授权不延续到后续轮次。
- 交付前验证：`pnpm check` 通过；`pnpm test` 262/262；`pnpm build` 通过。
- 包内身份已确认：`mnaddon.json` version `2.4.2`、addonid `marginnote.extension.mn4-answer-matcher`、title `CardLink`、`stable` 渠道。
- 交付副本 `E:\iCloudDrive\同步文件夹\CardLink-v2.4.2.mnaddon` 已替换；源文件与副本 SHA-256 均为 `c53e9e4ad7862cad671839b0c1bfadfec7fcd4e89e5c0f5ad95a06e95aeba007`（581,349 bytes）。
- `RELEASE_NOTES_v2.4.2.md` 已同步：新增纯文字错题分析修复、答案匹配治理三条用户可见变更，并更新验证数据。
- 未发布到 GitHub/Gitee：发布需另行明确授权。
