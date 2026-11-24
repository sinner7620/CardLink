import { sha256Hex as platformSha256Hex } from "../../platform/sha256.ts";
import type { SqlDriver } from "./driver.ts";

export type { SqlDriver } from "./driver.ts";

// v1 基础 schema（规范 §7；level 用 NULL 表达 unknown/缺失，以满足 §12"缺失与零值区分"）。
// P4-0 起内联为字符串：运行时读文件依赖 node:fs，JSB 环境不可用；与 schema.sql 内容保持一致。
const BASE_SCHEMA_SQL = `-- CardLink Harness H1 存储Schema v1（规范 §7）
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  snapshot_id TEXT
);

CREATE TABLE IF NOT EXISTS session_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS tool_audit (
  audit_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  policy_status TEXT NOT NULL,
  reviewer_approved INTEGER,
  reviewer_reason TEXT,
  execution_status TEXT NOT NULL,
  args_summary TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, tool_call_id)
);

CREATE TABLE IF NOT EXISTS turn_results (
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, request_id)
);

CREATE TABLE IF NOT EXISTS mistake_projection (
  record_id TEXT PRIMARY KEY,
  source_notebook_id TEXT NOT NULL,
  source_note_id TEXT NOT NULL,
  source_available INTEGER NOT NULL,
  source_title TEXT NOT NULL,
  source_notebook_title TEXT NOT NULL,
  source_root_title TEXT,
  source_path_titles_json TEXT NOT NULL,
  category_path_json TEXT NOT NULL,
  manual_categories_json TEXT NOT NULL,
  reason_tags_json TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  error_reasons_json TEXT NOT NULL,
  question_text TEXT,
  answer_text TEXT,
  text_status TEXT NOT NULL,
  level INTEGER,
  review_count INTEGER NOT NULL DEFAULT 0,
  review_completed INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  last_reviewed_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  answer_notebook_id TEXT,
  answer_root_node_id TEXT,
  content_hash TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  missing_in_latest INTEGER NOT NULL DEFAULT 0,
  superseded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_projection_notebook ON mistake_projection(source_notebook_id);
CREATE INDEX IF NOT EXISTS idx_projection_due ON mistake_projection(review_completed, next_review_at);
CREATE INDEX IF NOT EXISTS idx_projection_level ON mistake_projection(level);
CREATE INDEX IF NOT EXISTS idx_projection_missing ON mistake_projection(missing_in_latest, source_notebook_id);

CREATE TABLE IF NOT EXISTS review_events (
  event_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES mistake_projection(record_id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  level INTEGER,
  error_reason_json TEXT,
  source TEXT NOT NULL DEFAULT 'cardlink_history',
  payload_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(record_id, occurred_at, event_type, level)
);

CREATE INDEX IF NOT EXISTS idx_review_events_record ON review_events(record_id, occurred_at);

CREATE TABLE IF NOT EXISTS sync_batches (
  batch_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL,
  is_full_snapshot INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  record_count INTEGER NOT NULL
);`;

const MIGRATIONS: string[] = [
  // v1: 基础 schema（sessions/session_events/tool_audit/turn_results/mistake_projection/review_events/sync_batches）
  BASE_SCHEMA_SQL,
  // v2（规范 §7/§11）：Run 生命周期（runs/tool_calls，argsHash 幂等冲突检测）
  `CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    iteration INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, created_at);
  CREATE TABLE IF NOT EXISTS tool_calls (
    session_id TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    policy_status TEXT NOT NULL,
    reviewer_approved INTEGER,
    reviewer_reason TEXT,
    execution_status TEXT NOT NULL,
    result_json TEXT,
    evidence_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(session_id, tool_call_id)
  );`,
  // v3（规范 §7）：tool_audit 改为事件源（无 (session, tool_call) 唯一约束）——
  // 幂等冲突反馈、复核否决等事件允许多条；结果幂等由 tool_calls 主键承担。
  `CREATE TABLE IF NOT EXISTS tool_audit_v2 (
    audit_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    policy_status TEXT NOT NULL,
    reviewer_approved INTEGER,
    reviewer_reason TEXT,
    execution_status TEXT NOT NULL,
    args_summary TEXT,
    created_at TEXT NOT NULL
  );
  INSERT INTO tool_audit_v2 SELECT * FROM tool_audit;
  DROP TABLE tool_audit;
  ALTER TABLE tool_audit_v2 RENAME TO tool_audit;
  CREATE INDEX IF NOT EXISTS idx_tool_audit_session ON tool_audit(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tool_audit_call ON tool_audit(tool_call_id);`,
  // v4（规范 §6.2/§7）：版本化快照投影（manifest + PRIMARY KEY(snapshot_id, record_id)）。
  // 迁移：旧 sync_batches 的最新批次映射为 snapshots 清单，当前投影行复制为该快照版本。
  `CREATE TABLE IF NOT EXISTS snapshots (
    snapshot_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_revision TEXT NOT NULL DEFAULT '',
    complete INTEGER NOT NULL DEFAULT 1,
    scope_json TEXT NOT NULL DEFAULT '{}',
    imported_at TEXT NOT NULL,
    data_as_of TEXT NOT NULL,
    source_hash TEXT NOT NULL DEFAULT '',
    record_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS mistake_projection_v2 (
    snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE CASCADE,
    record_id TEXT NOT NULL,
    source_notebook_id TEXT NOT NULL,
    source_note_id TEXT NOT NULL,
    source_available INTEGER,
    level INTEGER,
    review_count INTEGER,
    review_completed INTEGER,
    next_review_at TEXT,
    last_reviewed_at TEXT,
    favorite INTEGER,
    category_path_json TEXT NOT NULL DEFAULT '[]',
    manual_categories_json TEXT NOT NULL DEFAULT '[]',
    custom_tags_json TEXT NOT NULL DEFAULT '[]',
    reason_tags_json TEXT NOT NULL DEFAULT '[]',
    error_reasons_json TEXT NOT NULL DEFAULT '[]',
    source_title TEXT,
    source_notebook_title TEXT,
    source_root_title TEXT,
    source_path_titles_json TEXT,
    question_text TEXT,
    answer_text TEXT,
    text_status TEXT,
    created_at TEXT,
    updated_at TEXT,
    answer_notebook_id TEXT,
    answer_root_node_id TEXT,
    content_hash TEXT NOT NULL DEFAULT '',
    raw_json TEXT NOT NULL DEFAULT '{}',
    ocr_json TEXT,
    PRIMARY KEY(snapshot_id, record_id)
  );
  CREATE INDEX IF NOT EXISTS idx_v2_due ON mistake_projection_v2(snapshot_id, next_review_at);
  CREATE INDEX IF NOT EXISTS idx_v2_notebook ON mistake_projection_v2(snapshot_id, source_notebook_id);
  INSERT INTO snapshots(snapshot_id, source_id, source_revision, complete, scope_json, imported_at, data_as_of, source_hash, record_count)
    SELECT b.snapshot_id, b.source_id, '', b.is_full_snapshot, '{}', b.imported_at, b.imported_at, '', b.record_count
    FROM sync_batches b
    WHERE b.imported_at = (SELECT MAX(b2.imported_at) FROM sync_batches b2);
  INSERT OR IGNORE INTO mistake_projection_v2(
      snapshot_id, record_id, source_notebook_id, source_note_id, source_available, level, review_count,
      review_completed, next_review_at, last_reviewed_at, favorite, category_path_json, manual_categories_json,
      custom_tags_json, reason_tags_json, error_reasons_json, source_title, source_notebook_title,
      source_root_title, source_path_titles_json, question_text, answer_text, text_status,
      created_at, updated_at, answer_notebook_id, answer_root_node_id, content_hash
    )
    SELECT
      (SELECT snapshot_id FROM snapshots ORDER BY imported_at DESC LIMIT 1),
      p.record_id, p.source_notebook_id, p.source_note_id, p.source_available, p.level, p.review_count,
      p.review_completed, p.next_review_at, p.last_reviewed_at, p.favorite, p.category_path_json, p.manual_categories_json,
      '[]', p.reason_tags_json, p.error_reasons_json, p.source_title, p.source_notebook_title,
      p.source_root_title, p.source_path_titles_json, p.question_text, p.answer_text, p.text_status,
      p.created_at, p.updated_at, p.answer_notebook_id, p.answer_root_node_id, p.content_hash
    FROM mistake_projection p
    WHERE p.missing_in_latest = 0;`,
  // v5（规范 §6.2/§7）：① review_events 重建——去掉指向旧表 mistake_projection 的外键
  //（版本化导入只写 v2 投影，带复习历史的记录此前会触发 FOREIGN KEY 失败）；
  // 事件完整性由导入逻辑保证（仅随快照记录写入），去重仍由 UNIQUE 承担。
  // ② evidence 表落地（§7）：工具结果证据行，getEvidence 按 evidence_id 查询。
  `CREATE TABLE IF NOT EXISTS review_events_v5 (
    event_id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    level INTEGER,
    error_reason_json TEXT,
    source TEXT NOT NULL DEFAULT 'cardlink_history',
    payload_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(record_id, occurred_at, event_type, level)
  );
  INSERT INTO review_events_v5 SELECT * FROM review_events;
  DROP TABLE review_events;
  ALTER TABLE review_events_v5 RENAME TO review_events;
  CREATE INDEX IF NOT EXISTS idx_review_events_record ON review_events(record_id, occurred_at);
  CREATE TABLE IF NOT EXISTS evidence (
    evidence_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    snapshot_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    result_hash TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(run_id);`,
  // v6（§5.1.3 + §12.2 修订 2026-11-14）：Provider/角色/密钥持久化。
  // 密钥经每安装随机密钥流加密混淆存储（非 Keychain 级；UI 明示，用户可清除/关闭持久化）。
  `CREATE TABLE IF NOT EXISTS model_providers (
    provider_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_roles (
    role TEXT PRIMARY KEY,
    setting_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_credentials (
    credential_ref TEXT PRIMARY KEY,
    secret_enc TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS device_secret (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    secret TEXT NOT NULL
  );`,
  // v7（v2.2 §10.1）：会话审核档位。可空列，NULL 按默认 'provenance' 读取；增量迁移非破坏性。
  `ALTER TABLE sessions ADD COLUMN review_level TEXT;`,
  // v8（v2.4 §13.1）：会话标题与软删除标记。可空列；NULL = 未命名/未删除。
  `ALTER TABLE sessions ADD COLUMN title TEXT;
  ALTER TABLE sessions ADD COLUMN deleted_at TEXT;
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);`,
  // v9（v2.4 §11.1）：Run 终止原因。可空列；旧记录 NULL 按未知读取。
  `ALTER TABLE runs ADD COLUMN finish_reason TEXT;`,
  // v10（v2.5 §5.2/§11.1）：token 用量列 + 持久化压缩记录 + 模型能力/校准。
  // 全部为非破坏性增量：旧行 NULL 表示"服务商未返回用量且未估算"。
  `ALTER TABLE runs ADD COLUMN prompt_tokens INTEGER;
  ALTER TABLE runs ADD COLUMN completion_tokens INTEGER;
  ALTER TABLE runs ADD COLUMN total_tokens INTEGER;
  ALTER TABLE runs ADD COLUMN usage_estimated INTEGER;
  CREATE TABLE IF NOT EXISTS session_compactions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    first_kept_message_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    snapshot_id TEXT,
    tokens_before INTEGER,
    tokens_after INTEGER,
    model_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_compactions_session ON session_compactions(session_id, created_at);
  CREATE TABLE IF NOT EXISTS model_capabilities (
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    context_window_tokens INTEGER NOT NULL,
    max_output_tokens INTEGER NOT NULL,
    supports_tool_calls INTEGER NOT NULL,
    supports_usage INTEGER NOT NULL,
    token_estimator_id TEXT NOT NULL,
    source TEXT NOT NULL,
    calibration_ratio REAL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(provider_id, model_id)
  );`,
  // v11 (§11.1): 现有摘要仍用 first_kept_message_id 恢复；新记录补充压缩元数据。
  `ALTER TABLE session_compactions ADD COLUMN last_compressed_sequence_no INTEGER;
  ALTER TABLE session_compactions ADD COLUMN summary_hash TEXT;
  ALTER TABLE session_compactions ADD COLUMN trigger_reason TEXT;
  CREATE INDEX IF NOT EXISTS idx_compactions_boundary ON session_compactions(session_id, first_kept_message_id);`,
  // v12: atomic request ownership, without rewriting historical runs or evidence.
  `CREATE TABLE IF NOT EXISTS run_requests (
    session_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id) ON DELETE CASCADE,
    PRIMARY KEY(session_id, request_id)
  );
  INSERT OR IGNORE INTO run_requests(session_id, request_id, run_id)
    SELECT r.session_id, r.request_id, r.run_id FROM runs r
    LEFT JOIN turn_results t ON t.session_id = r.session_id AND t.request_id = r.request_id
    ORDER BY CASE WHEN json_valid(t.result_json) THEN json_extract(t.result_json, '$.runId') = r.run_id END DESC,
      r.created_at ASC, r.rowid ASC;`,
  // v13（v2.14 §22）：上下文用量遥测与手动费率（H1 元数据；不触碰 CardLink 原始数据）。
  // 全部为新表，非破坏性迁移；旧库升级后遥测为空（不回填历史请求明细）。
  `CREATE TABLE IF NOT EXISTS assistant_requests (
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    request_seq INTEGER NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    finish_reason TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    instruction_tokens INTEGER NOT NULL DEFAULT 0,
    compaction_tokens INTEGER NOT NULL DEFAULT 0,
    tool_definition_tokens INTEGER NOT NULL DEFAULT 0,
    message_tokens INTEGER NOT NULL DEFAULT 0,
    tool_result_tokens INTEGER NOT NULL DEFAULT 0,
    overhead_tokens INTEGER NOT NULL DEFAULT 0,
    input_total_tokens INTEGER NOT NULL DEFAULT 0,
    input_budget_tokens INTEGER NOT NULL DEFAULT 0,
    output_budget_tokens INTEGER NOT NULL DEFAULT 0,
    reserved_tokens INTEGER NOT NULL DEFAULT 0,
    compaction_trigger_tokens INTEGER NOT NULL DEFAULT 0,
    compaction_id TEXT,
    compaction_applied INTEGER NOT NULL DEFAULT 0,
    compaction_trigger_reason TEXT,
    prompt_tokens INTEGER,
    prompt_source TEXT,
    completion_tokens INTEGER,
    completion_source TEXT,
    reported_prompt_tokens INTEGER,
    reported_completion_tokens INTEGER,
    usage_estimated INTEGER NOT NULL DEFAULT 0,
    rate_currency TEXT,
    rate_input_per_million REAL,
    rate_output_per_million REAL,
    rate_updated_at TEXT,
    PRIMARY KEY(session_id, run_id, request_seq)
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_requests_session ON assistant_requests(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_assistant_requests_run ON assistant_requests(run_id);
  CREATE TABLE IF NOT EXISTS model_rates (
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    input_per_million REAL NOT NULL,
    output_per_million REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(provider_id, model_id)
  );`,
  // v14（v2.16 §6.1/§6.3/§11.3）：答案正文投影来源、本地源指纹基线与运行预算档位。
  // 全部为加法列/新表；旧行为 NULL，按旧导入与既有配置上限读取。
  `ALTER TABLE mistake_projection_v2 ADD COLUMN answer_text_origin TEXT;
  ALTER TABLE mistake_projection_v2 ADD COLUMN answer_source_notebook_id TEXT;
  ALTER TABLE mistake_projection_v2 ADD COLUMN answer_source_note_id TEXT;
  ALTER TABLE mistake_projection_v2 ADD COLUMN answer_status TEXT;
  ALTER TABLE mistake_projection_v2 ADD COLUMN answer_reason TEXT;
  ALTER TABLE runs ADD COLUMN budget_tier TEXT;
  ALTER TABLE sessions ADD COLUMN budget_tier TEXT;
  CREATE TABLE IF NOT EXISTS source_baselines (
    source_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  // v15（v2.17 §4）：迁移时记录已有会话的生效助手配置。
  `ALTER TABLE sessions ADD COLUMN assistant_model_json TEXT;
  UPDATE sessions SET assistant_model_json =
    (SELECT setting_json FROM model_roles WHERE role = 'assistant');
  CREATE TABLE model_role_authorizations (
    role TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    PRIMARY KEY(role, provider_id)
  );
  ALTER TABLE model_credentials ADD COLUMN revision TEXT NOT NULL DEFAULT 'legacy';
  CREATE TABLE model_connection_checks (
    credential_ref TEXT NOT NULL REFERENCES model_credentials(credential_ref) ON DELETE CASCADE,
    model TEXT NOT NULL,
    revision TEXT NOT NULL,
    reachable INTEGER NOT NULL CHECK(reachable IN (0, 1)),
    PRIMARY KEY(credential_ref, model)
  );`,
  // v16：分支只记录共享前缀，事件和证据仍保存在其创建时的会话。
  `ALTER TABLE sessions ADD COLUMN selected_branch_id TEXT;
  CREATE TABLE session_branches (
    branch_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
    root_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    parent_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    prefix_count INTEGER NOT NULL,
    anchor_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('edit', 'regenerate')),
    request_id TEXT NOT NULL,
    UNIQUE(root_id, request_id)
  );
  CREATE INDEX idx_session_branches_root ON session_branches(root_id);`,
  `CREATE TABLE run_questions (
    question_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    closed INTEGER NOT NULL,
    submission_id TEXT,
    answers_json TEXT,
    draft_json TEXT
  );
  CREATE UNIQUE INDEX idx_run_question_open ON run_questions(run_id) WHERE closed = 0;
  CREATE INDEX idx_session_question_open ON run_questions(session_id, closed);
  CREATE TABLE run_public_plans (
    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL
  );
  CREATE TABLE public_assistant_outcomes (
    session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY(session_id, message_id)
  );`,
];

/** 迁移执行（驱动无关）：JSB/Node 共用。供 openDatabase(node-driver) 与 bootstrap-jsb 调用。 */
export function migrate(driver: SqlDriver, targetVersion = MIGRATIONS.length): void {
  driver.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const row = driver.rows("SELECT MAX(version) AS v FROM schema_migrations")[0] as { v: number | null } | undefined;
  const current = Number(row?.v ?? 0);
  for (let v = current; v < Math.min(targetVersion, MIGRATIONS.length); v++) {
    applyMigration(driver, v + 1, MIGRATIONS[v] as string);
  }
}

function applyMigration(driver: SqlDriver, version: number, script: string): void {
  driver.transaction(() => {
    driver.exec(script);
    driver.exec("INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)", [version, new Date().toISOString()]);
  });
}

/** 规范化 JSON：键排序，保证 contentHash 稳定。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortValue((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(text: string): string {
  // P4-0：纯 JS 实现（platform/sha256），Node 与 JSB 同代码同字节；
  // 与 node:crypto 的等价性由 tests/platform 覆盖。
  return platformSha256Hex(text);
}
