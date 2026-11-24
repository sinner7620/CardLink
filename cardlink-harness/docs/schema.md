# H1 存储 Schema（agent_h1.sqlite）

驱动：Node 内置 `node:sqlite`（DatabaseSync）。每次打开执行：
`PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON`、`PRAGMA busy_timeout=1000`。
迁移由 `src/adapters/sqlite/db.ts` 按 `schema_migrations(version, applied_at)` 依次执行。

## 会话

- `sessions(session_id PK, created_at, updated_at, status, scope_json, snapshot_id)`
- `session_events(event_id PK, session_id FK→sessions ON DELETE CASCADE, sequence_no, message_type, payload_json, created_at, UNIQUE(session_id, sequence_no))`
- `turn_results(session_id, request_id, result_json, created_at, UNIQUE(session_id, request_id))` — requestId 幂等（T12）。
- `run_requests(session_id, request_id, run_id UNIQUE FK→runs ON DELETE CASCADE, PK(session_id, request_id))` — v12 中的请求与 Run 映射，和 Run 检查点同事务创建。迁移保留旧 Run 并回填首选映射。
- `tool_audit(audit_id PK, session_id, tool_call_id, tool_name, policy_status, reviewer_approved, reviewer_reason, execution_status, args_summary, created_at, UNIQUE(session_id, tool_call_id))` — 与 `session_events` 的工具结果写入同事务（原子，§10.2）。

## 只读投影

- 版本化快照在 `snapshots` 和 `mistake_projection_v2` 存放。最新快照的内容指纹基于排序后的逐条记录哈希，同源、同范围及同完整性口径下用于跳过内容相同的同步。

- `mistake_projection(record_id PK, source_notebook_id, source_note_id, source_available, source_title, source_notebook_title, source_root_title, source_path_titles_json, category_path_json, manual_categories_json, reason_tags_json, favorite, error_reasons_json, question_text, answer_text, text_status, level INTEGER NULL, review_count, review_completed, next_review_at, last_reviewed_at, created_at, updated_at, answer_notebook_id, answer_root_node_id, content_hash, snapshot_id, missing_in_latest, superseded_by)`
  - `level NULL` = unknown/缺失（§12 缺失与零值区分）。
  - `content_hash` = 规范化 JSON（键排序）的 sha256，不含 snapshotId（跨批次可比）。
  - `missing_in_latest=1`：完整快照缺失标记或 recordId 修复被替换——保留不删除（T07/T21）。
  - 所有查询强制 `missing_in_latest = 0`。
- `review_events(event_id PK, record_id FK→projection ON DELETE CASCADE, occurred_at, event_type('mark'|'review'), level NULL, error_reason_json, source, payload_json, UNIQUE(record_id, occurred_at, event_type, level))` — 导入幂等去重（T06）。
- `sync_batches(batch_id PK, source_id, snapshot_id UNIQUE, imported_at, is_full_snapshot, scope, status, record_count)`。

## 统计口径（§12，全部 SQL/确定性计算）

- 时间统一存 UTC ISO 字符串；到期比较为字符串比较（归一化后正确）。
- `dueCount`：`review_completed=0 AND next_review_at < dueBoundary`；dueBoundary = 统计时区的“本地今天 24:00”（`StatisticsEngine.endOfLocalDay` 计算，参数回传）。
- `reviewedCount`：`last_reviewed_at IS NOT NULL`（不用 `reviewCount>0`——等级变更会归零）。
- `reviewEventCount`：`review_events.event_type='review'` 计数（不含入册标记）。
- `levelCounts`：按 `level` 分组，NULL 归 `unknown`（防御性兜底）。

## v2.16 增量（迁移 v14，均为加法）

- `mistake_projection_v2.answer_text_origin / answer_source_notebook_id / answer_source_note_id / answer_status / answer_reason`：
  设备答案正文投影来源与实际答案笔记身份。NULL = 旧导入语义（`answer_notebook_id` + `answer_root_node_id`）。
  覆盖率与详情分段按此区分来源；`answer_reason` 只写规范枚举值。
- `runs.budget_tier TEXT`：Run 入列时固定的预算档位（`simple|comparison|deep`，NULL = 未选档旧调用）。
- `sessions.budget_tier TEXT`：会话默认档位（UI 选中状态；NULL 按简单档显示）。
- `source_baselines(source_id PK, fingerprint, snapshot_id, updated_at)`：本地源投影指纹基线。**只在该次导入成功返回快照后写入**；
  新鲜度判定要求指纹一致且基线快照 = 最新快照，否则 `stale`/`unknown`（§6.3）。
- 覆盖率报表不建新表：数值由 `mistake_projection_v2` 与 `json_each(raw_json,'$.history')`/`custom_tags_json` 在运行锁定快照内即时聚合（§9.3）。
