-- CardLink Harness H1 存储Schema v1（规范 §7；level 用 NULL 表达 unknown/缺失，
-- 以满足 §12“缺失与零值区分”。）
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
);
