# H1 外部 API（规范 §13）

Base：`http://127.0.0.1:<port>`（默认 7310，仅回环绑定）。
除 `/h1/health` 与静态资源外，一律要求 `Authorization: Bearer <H1_HTTP_TOKEN>`。
Origin 头存在且不在 `H1_CORS_ORIGIN` 时返回 403。请求体上限 2MB。

## GET /h1/health

无鉴权。返回 `{ ok: true, snapshotId, version }`。

## POST /h1/sessions

```json
{ "scope": { "notebookIds": ["..."], "subject": "可选" } }
```
→ `200 { "sessionId": "..." }`；scope 非法 → `400 { error: { code: "invalid_scope" } }`。
空 `notebookIds` 表示授权全部已导入笔记本。

## GET /h1/sessions?limit=20&cursor=...

→ `{ sessions: Session[], nextCursor? }`（按创建时间倒序）。
下一页直接传回 `nextCursor` 作为 `cursor` 查询参数；末页省略 `nextCursor`。

## GET /h1/sessions/:sessionId

→ `200 Session`（含全部消息）；不存在 → 404。

## POST /h1/sessions/:sessionId/messages

```json
{ "requestId": "幂等标识", "text": "用户消息（≤8000 字符）" }
```
→ `200`：
```json
{
  "status": "completed | limit_reached | error",
  "message": "最终答复（completed 时）",
  "evidenceRefs": ["本轮读取且引用的 recordId 或 stat:<evidenceId>"],
  "warnings": [{ "code": "unknown_record_reference|record_not_read_this_turn|unverified_statistic", "detail": "..." }],
  "error": { "code": "model_error|invalid_message|session_not_found|...", "message": "..." }
}
```
同一 `(sessionId, requestId)` 重放沿用首个 Run；已完成时返回该 Run 的结果。

## POST /h1/import/cardlink-snapshot

```json
{ "schemaVersion": 1, "sourceId": "...", "exportedAt": "ISO", "isFullSnapshot": true, "records": [ ... ] }
```
同时接受插件备份形态 `{ "version": 2, "records": { "<recordId>": {...} } }`（§6.3）。
增量导入可传 `baseRevision`（基线快照 ID），提交时核对该 ID 与最新版本。旧增量载荷沿用接收时的最新基线。完整导入中，同源同范围内容相同的最新快照返回原 ID。
→ `200 { snapshotId, inserted, updated, unchanged, unavailable, repaired, markedMissing?, warnings[], sourceKind }`
校验失败 → `422 { error: { code: "snapshot_invalid", diagnostics: [...] } }`（整批回滚）。
严禁匿名写入：缺少/错误令牌 → 401。

单条记录可选 v2.16 答案字段：`answerTextOrigin`（`import|answer_card`）、`answerSourceNotebookId`、`answerSourceNoteId`、`answerStatus`（`projected|unavailable|missing`）、`answerReason`（受枚举校验）。
旧载荷不带这些键时按旧导入语义（`answerNotebookId` + `answerRootNodeId`）读取；`answerReason` 只接受规范列出的原因值。

## 模型可见只读工具（规范 §9/§9.2/§9.3/§9.4，v2.13 + v2.16 + v2.18 增量）

五个工具仍是唯一模型可见通道；下表只列 v2.13/v2.16/v2.18 新增的可选参数，省略时行为与返回字段不变。
所有参数经实际模型 Schema（`additionalProperties:false`）、`PolicyGuard` 与 `ToolExecutor` 校验。

| 工具 | 新增可选参数 | 行为与边界 |
|---|---|---|
| `queryMistakes` | `contentQuery`（去首尾空白 1..128 字面短语） | 匹配投影标题与有效题干（含用户修订）。中文按连续子串；仅 ASCII 大小写不敏感；`%`/`_`/引号/`MATCH`/`NEAR` 等均为字面量，值全部绑定。与等级/范围/到期/排序取交集。结果不含题干与答案正文 |
| `queryMistakes` | `recordIds`（1..10 个已知 ID） | 去重并受授权 scope 约束，返回安全元数据；`missingRecordIds` 只列**真正未匹配**的 ID（用同快照同条件的完整匹配集合判定，后续页不误报）；不可见与不存在项同结果 |
| `queryMistakes` | 游标（含 `contentQuery`/`recordIds` 时） | 紧凑锚点游标：仅「查询指纹 + 锚点 `recordId` + 校验值」，不含分类/标题/排序元组；keyset 排序键由服务端在同快照/同 scope/同筛选下按锚点重新取回。长度恒 < 512（与文本长度无关），`dueAtAsc`/`reviewCountDesc` 同样适用；旧查询沿用原游标格式 |
| `getMistakeDetail` | `content: { field:'question'\|'answer', offset?, limit?(1..4000) }` | `offset`/`limit` 以 Unicode 码点计，返回 `contentSegment { text, totalLength, nextOffset?, hasMore, available, reason?, source? }`；末段省略 `nextOffset`。分段模式 `record` 不带任何字段正文。**v2.16 答案来源**：设备投影（`answerTextOrigin='answer_card'`）要求 `answerSourceNotebookId` + `answerSourceNoteId`（实际匹配的答案笔记，不是答案脑图根）且来源学习集在会话 scope 内，否则 `answer_source_unlocatable` / `answer_source_out_of_scope`；旧导入沿用 `answerNotebookId` + `answerRootNodeId` 旧口径。投影不可用原因（`answer_ambiguous` / `answer_index_unavailable` / `answer_not_found` / `answer_text_empty` 等）原样返回。旧 `includeText` / 默认详情不自动发送设备新增答案正文（只给 `answerTextOmitted` 长度） |
| `getMistakeStats` | `report:'coverage'`、`limit`（1..50，默认 20） | v2.16 §9.3：按 `notebook`（学习集 ID，同名不同 ID 分组）/ `category`（分类首层）/ `customTag`（多值非互斥）返回 `recordCount` 与题干、可授权且可定位的答案、可核验复习历史覆盖率；`recordsWithoutValue`、`totalGroups`、`truncated`、`omittedGroups` 明示空值与截断；排序 `recordCount` 降序 + `key` 升序。`matchingRecords` 为筛选内总题数；`statsTime/timezone` 不适用于到期口径。**只由 StatisticsEngine + 参数化 SQLite 在同一快照与 scope 产生**，数值可进入统计证据（`dimensions.N.groups.M.recordCount` 等） |
| `getMistakeStats` | `report:'repeatedReviewErrors'`、`reviewFrom`、`reviewBefore`、`limit` | v2.18 §9.4：在 `[reviewFrom, reviewBefore)` 内统计**可核实复习事件**（排除入册 mark 与无效时间）中带非空错因键的事件（key/label 按 JS `String.trim` 空白集合去空白，边缘空白同键归一；纯空白键不计）；同一题至少 2 笔才入榜，按事件数降序、`recordId` 升序、`limit`（默认 20、最大 50）截断。返回 `matchingRecords`、`reviewCoverage`、`reviewedRecordsInWindow`、`recordsWithQualifyingEvents`、`totalMatchedRecords`、`totalQualifyingEvents`、`window`、`records[]`（recordId/eventCount/lastEventAt/最多 5 个 errorKeys/errorKeyCount）、`truncated`/`omittedRecords`、固定 `interpretation` 与 `notes`。只表示"多次复习记录带错因（或重复记录同一错因）"，不代表实际答错/正确率/因果；不返回题干、答案或 OCR 正文。`evidence.recordIds` 为本次榜单记录，可用于授权下钻和卡片引用；数值进入统计引用白名单 |
| `getReviewHistory` | `order: 'asc'\|'desc'`、`cursor`、`reviewFrom`、`reviewBefore` | 默认仍升序 50 条（上界 100）；`desc` 用于"最近几次"。同一时间戳按事件序号 tie-break。游标是记录/快照/排序/过滤的紧凑绑定指纹（约 110 字符，与 ID 长度无关），并校验锚点有效；新分支只用 `nextCursor` 分页、不置 `truncated`，旧的完全无新参数调用保留原 `truncated` 标记。时间比较按实际发生时刻，`total` 为全部条数、`totalMatching` 为过滤后条数 |

检索实现（v2.13）：在授权范围内使用参数化 SQLite 字面匹配（`instr(lower(...), ?)`），复杂度 O(匹配范围内行数 × 文本长度)；
FTS5 需要与每个锁定快照保持语义一致并验证真机虚表能力，列为后续优化，不改变上述语义。

**v2.16 设备答案正文（§6.1）**：插件 `harness.syncSnapshot` 会按既有绑定/答案索引确定**唯一**匹配的答案卡片，投影其纯文本与实际答案笔记身份到快照：
`answerTextOrigin='answer_card'`、`answerSourceNotebookId`、`answerSourceNoteId`、`answerStatus`（`projected|unavailable|missing`）、`answerReason`。
无绑定/无匹配/多候选/索引不可用/卡片不可读/空文一律显式不可用，不以答案脑图根、根标题或预览 HTML 兜底。
无 Schema 破坏：迁移 v14 为加法列（旧行 NULL = 旧导入语义）。

## 插件命令

- `harness.syncSnapshot` 默认检查完整的插件源视图，并以事务内核对的同源快照为基线导入差异。首轮、无同源基线或检测到记录移除时执行全量导入。传 `{ "full": true }` 可指定全量比较。同源内容未改变时复用当前快照。
  响应含 `snapshotId/recordCount/inserted/updated/unchanged/carried/repaired/markedMissing/warnings/sourceKind`，v2.16 另含 `answerProjection { projected, unavailable, missing }`、`trackedDimensions` 与 `freshness { status, snapshotId, dataAsOf?, warning? }`；导入成功后才写入本地源指纹基线。
- `harness.getDataFreshness`（只读，v2.16 §6.3）返回 `{ status: 'current'|'stale'|'unknown', reason?, snapshotId, dataAsOf?, baselineSnapshotId?, baselineFingerprintAt?, checkedAt, counts?, tracked, answerChanges: 'not_tracked', answerChangesNote }`。
  判定要求「当前投影指纹 == 基线指纹」且「基线快照 == 最新快照」；无基线、指纹无法计算或同步失败后不谎报 `current`。答案卡片正文的变化**没有**轻量本地信号，需同步刷新（`not_tracked`）。
- `harness.setBudgetTier { sessionId, tier: 'simple'|'comparison'|'deep' }`（v2.16 §11.3）：保存会话默认运行预算档位；未知档拒绝。
- `harness.startRun { sessionId, text, requestId, budgetTier? }` / `harness.continueRun { sessionId, requestId, budgetTier? }`：档位由用户/可信 UI 选择，在 Run 入列时固定并落 `runs.budget_tier`。`simple=4/8`、`comparison=8/16`、`deep=12/24`（迭代/本 Run 工具总量），受管理员硬上限 `H1_HARD_MAX_ITERATIONS` / `H1_HARD_MAX_TOOL_CALLS` / `H1_HARD_MAX_RUN_DURATION_MS`（默认 12/24/1200000）约束。未携带档位的旧调用沿用 `H1_MAX_ITERATIONS` / `H1_MAX_TOOL_CALLS_PER_TURN`（默认 4/8）。`continueRun` 未指定档位时沿用会话最近一次 Run 的档位。
- **续答快照（v2.16 §6.3）**：`continueRun` 使用该会话最近一次 Run 锁定的快照（工具结果、`evidence.snapshotId/dataAsOf` 与之一致），即使此后已导入更新的快照；历史 Run 快照为 `none` 时按空快照继续；锁定快照元数据不可读时返回失败（错误消息含 `snapshot_unavailable`），**不回退到最新快照**。新的 `startRun` 使用最新快照。桥接层在预占 Run 之前决定快照，`requestId` 重放仍返回原 Run。
- 崩溃恢复（上一轮遗留的悬空工具调用）与正常循环共用本 Run 的预算、已执行工具计数和总时限；拒绝/非法调用不占额度，达到上限后停止且可续。
- `harness.getRunStatus` 额外回显 `budgetTier` 与 `budget { tier, maxIterations, maxToolCalls, maxDurationMs, usedToolCalls }`；达到本 Run 迭代/工具上限为 `finishReason='iteration_limit'`，总时限为 `timeout`，均 `continuable`。
- `harness.cancelRun` 请求取消后，通过 `harness.getRunStatus` 获取终态。运行中的模型请求接收取消信号；取消后迟到的回复不进入会话。

## 错误包络

所有非 2xx：`{ "error": { "code": "...", "message": "..." } }`；日志不记录消息正文与密钥。
