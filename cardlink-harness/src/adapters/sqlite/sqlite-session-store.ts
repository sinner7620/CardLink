import { randomUUID } from "../../platform/uuid.ts";
import type { ModelRoleSetting } from "../../domain/provider.ts";
import type { AgentMessage } from "../../domain/message.ts";
import { DEFAULT_REVIEW_LEVEL, type ReviewLevel, type Session, type SessionId, type SessionStatus } from "../../domain/session.ts";
import type { BranchOperation, SessionBranchView, SessionStore, SessionSummary } from "../../application/ports/session-store.ts";
import { decodeCursor, encodeCursor } from "../../application/ports/session-store.ts";
import type { SqlDriver } from "./db.ts";

interface SessionRow {
  session_id: string;
  created_at: string;
  updated_at: string;
  status: string;
  scope_json: string;
  snapshot_id: string | null;
  review_level: string | null;
  budget_tier: string | null;
  title: string | null;
  deleted_at: string | null;
  assistant_model_json: string | null;
  selected_branch_id: string | null;
}

type BranchRow = { branch_id: string; root_id: string; parent_id: string; prefix_count: number; anchor_id: string; operation: BranchOperation };

function loadMessages(driver: SqlDriver, sessionId: string): Pick<Session, "messages" | "sharedMessageOwners"> {
  const segments: AgentMessage[][] = [];
  const owners = Object.create(null) as Record<string, string>;
  const visited = new Set<string>();
  let current = sessionId;
  let limit = -1;
  while (current && limit !== 0) {
    if (visited.has(current)) throw new Error("会话分支关系无效");
    visited.add(current);
    const branch = driver.rows("SELECT parent_id, prefix_count FROM session_branches WHERE branch_id = ?", [current])[0] as
      Pick<BranchRow, "parent_id" | "prefix_count"> | undefined;
    const prefix = Number(branch?.prefix_count ?? 0);
    const count = limit < 0 ? -1 : Math.max(0, limit - prefix);
    if (count !== 0) {
      const items = driver.rows("SELECT payload_json FROM session_events WHERE session_id = ? ORDER BY sequence_no ASC LIMIT ?", [current, count])
        .map((row) => JSON.parse(String(row.payload_json)) as AgentMessage);
      segments.push(items);
      if (current !== sessionId) for (const item of items) owners[item.id] = current;
    }
    limit = limit < 0 ? prefix : Math.min(limit, prefix);
    current = branch?.parent_id ?? "";
  }
  return { messages: segments.reverse().flat(), ...(Object.keys(owners).length ? { sharedMessageOwners: owners } : {}) };
}

function toBudgetTier(value: string | null): "simple" | "comparison" | "deep" | undefined {
  return value === "simple" || value === "comparison" || value === "deep" ? value : undefined;
}

function toSession(row: SessionRow, driver: SqlDriver): Session {
  return {
    id: row.session_id,
    ...loadMessages(driver, row.session_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scope: JSON.parse(row.scope_json),
    snapshotId: row.snapshot_id ?? undefined,
    status: row.status as SessionStatus,
    // v2.2 §10.1：NULL（含迁移前的旧会话）按默认档位读取。
    reviewLevel: (row.review_level as ReviewLevel | null) ?? DEFAULT_REVIEW_LEVEL,
    budgetTier: toBudgetTier(row.budget_tier),
    title: row.title ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    ...(row.assistant_model_json ? { assistantModel: JSON.parse(row.assistant_model_json) } : {}),
  };
}

/** LIKE 通配符转义：用 `#` 作转义符（避免反斜杠在 JS/SQL 间的书写歧义）。 */
function likeEscape(text: string): string {
  return text.replace(/[\\%_#]/g, (ch) => `#${ch}`);
}

/** 首条用户消息预览（≤80 字符）；无则 undefined。 */
function previewOf(payloadJson: string | null | undefined): string | undefined {
  if (!payloadJson) return undefined;
  try {
    const parsed = JSON.parse(String(payloadJson)) as { type?: string; text?: unknown };
    if (parsed.type !== "user" || typeof parsed.text !== "string") return undefined;
    const text = parsed.text.trim();
    return text ? text.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly driver: SqlDriver) {}

  branchView(rootId: string, branchId?: string): SessionBranchView {
    const root = this.driver.rows(
      "SELECT s.selected_branch_id FROM sessions s WHERE s.session_id = ? AND NOT EXISTS (SELECT 1 FROM session_branches b WHERE b.branch_id = s.session_id)",
      [rootId],
    )[0];
    if (!root) throw new Error("会话不存在");
    const rows = this.driver.rows(
      "SELECT branch_id, root_id, parent_id, prefix_count, anchor_id, operation FROM session_branches WHERE root_id = ? ORDER BY rowid",
      [rootId],
    ) as unknown as BranchRow[];
    const selected = branchId || String(root.selected_branch_id ?? rootId);
    if (selected !== rootId && !rows.some((row) => row.branch_id === selected)) throw new Error("分支不属于此会话");
    return {
      sessionId: rootId, branchId: selected,
      branches: [{ id: rootId }, ...rows.map((row) => ({ id: row.branch_id, parentId: row.parent_id, anchorId: row.anchor_id, operation: row.operation }))],
    };
  }

  fork(rootId: string, fromId: string, anchorId: string, operation: BranchOperation, requestId: string): SessionBranchView {
    return this.driver.transaction(() => {
      this.branchView(rootId, fromId);
      const existing = this.driver.rows(
        "SELECT branch_id, parent_id, anchor_id, operation FROM session_branches WHERE root_id = ? AND request_id = ?",
        [rootId, requestId],
      )[0];
      if (existing) {
        if (existing.parent_id !== fromId || existing.anchor_id !== anchorId || existing.operation !== operation) throw new Error("分支请求与已有请求冲突");
        return this.selectBranch(rootId, String(existing.branch_id));
      }
      const current = this.driver.rows("SELECT deleted_at FROM sessions WHERE session_id = ?", [fromId])[0];
      if (!current || current.deleted_at) throw new Error("会话不可用");
      const { messages } = loadMessages(this.driver, fromId);
      const anchor = messages.findIndex((message) => message.type === "user" && message.id === anchorId);
      if (anchor < 0) throw new Error("该问题不在当前分支");
      const branchId = randomUUID();
      const now = new Date().toISOString();
      this.driver.exec(
        `INSERT INTO sessions(session_id, created_at, updated_at, status, scope_json, snapshot_id, review_level, budget_tier, title, assistant_model_json)
          SELECT ?, ?, ?, 'active', scope_json, snapshot_id, review_level, budget_tier, title, assistant_model_json FROM sessions WHERE session_id = ?`,
        [branchId, now, now, fromId],
      );
      this.driver.exec(
        "INSERT INTO session_branches(branch_id, root_id, parent_id, prefix_count, anchor_id, operation, request_id) VALUES(?,?,?,?,?,?,?)",
        [branchId, rootId, fromId, anchor + (operation === "regenerate" ? 1 : 0), anchorId, operation, requestId],
      );
      return this.selectBranch(rootId, branchId);
    });
  }

  selectBranch(rootId: string, branchId: string): SessionBranchView {
    const view = this.branchView(rootId, branchId);
    this.driver.exec("UPDATE sessions SET selected_branch_id = ? WHERE session_id = ? AND deleted_at IS NULL", [branchId, rootId]);
    return view;
  }

  async create(session: Session): Promise<void> {
    this.driver.exec(
      "INSERT INTO sessions(session_id, created_at, updated_at, status, scope_json, snapshot_id, review_level, budget_tier, title, deleted_at, assistant_model_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [session.id, session.createdAt, session.updatedAt, session.status, JSON.stringify(session.scope), session.snapshotId ?? null, session.reviewLevel ?? DEFAULT_REVIEW_LEVEL, session.budgetTier ?? null, session.title ?? null, session.deletedAt ?? null, session.assistantModel ? JSON.stringify(session.assistantModel) : null],
    );
  }

  async bindInitialAssistant(id: SessionId, setting: ModelRoleSetting): Promise<void> {
    this.driver.exec("UPDATE sessions SET assistant_model_json = ? WHERE session_id = ? AND assistant_model_json IS NULL", [JSON.stringify(setting), id]);
  }

  async setAssistantModel(id: SessionId, setting: ModelRoleSetting): Promise<void> {
    this.driver.exec("UPDATE sessions SET assistant_model_json = ? WHERE session_id = ? AND deleted_at IS NULL", [JSON.stringify(setting), id]);
  }

  async get(id: SessionId): Promise<Session | null> {
    const row = this.driver.rows("SELECT * FROM sessions WHERE session_id = ?", [id])[0] as unknown as SessionRow | undefined;
    return row ? toSession(row, this.driver) : null;
  }

  async list(limit: number, cursor?: string): Promise<Session[]> {
    const capped = Math.max(1, Math.min(200, Math.floor(limit)));
    const decoded = cursor ? decodeCursor(cursor) : null;
    const rows = decoded
      ? this.driver.rows(
          "SELECT * FROM sessions WHERE deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM session_branches b WHERE b.branch_id = sessions.session_id) AND (created_at, session_id) < (?, ?) ORDER BY created_at DESC, session_id DESC LIMIT ?",
          [decoded.createdAt, decoded.id, capped + 1],
        )
      : this.driver.rows("SELECT * FROM sessions WHERE deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM session_branches b WHERE b.branch_id = sessions.session_id) ORDER BY created_at DESC, session_id DESC LIMIT ?", [capped + 1]);
    const page: Session[] = (rows as unknown as SessionRow[]).slice(0, capped).map((r) => toSession(r, this.driver));
    if (page.length === capped && rows.length > capped) {
      const last = page[page.length - 1] as Session;
      const withCursor = page as Session[] & { nextCursor?: string };
      withCursor.nextCursor = encodeCursor(last);
    }
    return page;
  }

  /**
   * v2.4 §13.1：摘要列表（不加载消息体）。messageCount 聚合、lastPreview 取首条用户消息；
   * query 非空时按标题/首条用户消息匹配（LIKE，转义 %/_/\）；按 updatedAt 倒序。已删除项一律排除。
   */
  async listSummaries(limit: number, query?: string): Promise<SessionSummary[]> {
    const capped = Math.max(1, Math.min(200, Math.floor(limit)));
    const filter = typeof query === "string" && query.trim() ? likeEscape(query.trim()) : null;
    const like = filter ? `%${filter}%` : null;
    const sql = like
      ? `SELECT s.session_id, s.created_at, s.updated_at, s.status, s.scope_json, s.snapshot_id, s.review_level, s.budget_tier, s.title, s.deleted_at,
           (SELECT COUNT(*) FROM session_events e WHERE e.session_id = s.session_id) AS message_count,
           (SELECT payload_json FROM session_events e2 WHERE e2.session_id = s.session_id AND e2.message_type = 'user' ORDER BY e2.sequence_no ASC LIMIT 1) AS first_user_json
         FROM sessions s
         WHERE s.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM session_branches h WHERE h.branch_id = s.session_id)
           AND (COALESCE(s.title, '') LIKE ? ESCAPE '#' OR EXISTS (
             SELECT 1 FROM session_events e3
             WHERE (e3.session_id = s.session_id OR e3.session_id IN (SELECT branch_id FROM session_branches WHERE root_id = s.session_id)) AND e3.message_type = 'user' AND e3.payload_json LIKE ? ESCAPE '#'
           ))
         ORDER BY s.updated_at DESC, s.session_id DESC LIMIT ?`
      : `SELECT s.session_id, s.created_at, s.updated_at, s.status, s.scope_json, s.snapshot_id, s.review_level, s.budget_tier, s.title, s.deleted_at,
           (SELECT COUNT(*) FROM session_events e WHERE e.session_id = s.session_id) AS message_count,
           (SELECT payload_json FROM session_events e2 WHERE e2.session_id = s.session_id AND e2.message_type = 'user' ORDER BY e2.sequence_no ASC LIMIT 1) AS first_user_json
         FROM sessions s
         WHERE s.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM session_branches h WHERE h.branch_id = s.session_id)
         ORDER BY s.updated_at DESC, s.session_id DESC LIMIT ?`;
    const params = like ? [like, like, capped] : [capped];
    const rows = this.driver.rows(sql, params) as unknown as Array<SessionRow & { message_count: number; first_user_json: string | null }>;
    return rows.map((row) => ({
      id: row.session_id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: row.status as SessionStatus,
      reviewLevel: (row.review_level as ReviewLevel | null) ?? DEFAULT_REVIEW_LEVEL,
      budgetTier: toBudgetTier(row.budget_tier),
      snapshotId: row.snapshot_id ?? undefined,
      messageCount: Number(row.message_count ?? 0),
      lastPreview: previewOf(row.first_user_json),
    }));
  }

  async rename(id: SessionId, title: string): Promise<void> {
    this.driver.transaction(() => {
      const exists = this.driver.rows("SELECT session_id FROM sessions WHERE session_id = ?", [id]);
      if (!exists.length) throw new Error(`会话不存在: ${id}`);
      this.driver.exec("UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?", [title, new Date().toISOString(), id]);
    });
  }

  /** v2.4 §13.1：软删除——只置 deleted_at；消息/运行/审计/证据行全部保留。幂等。 */
  async softDelete(id: SessionId): Promise<void> {
    this.driver.transaction(() => {
      const exists = this.driver.rows("SELECT session_id FROM sessions WHERE session_id = ?", [id]);
      if (!exists.length) throw new Error(`会话不存在: ${id}`);
      this.driver.exec("UPDATE sessions SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE session_id = ? OR session_id IN (SELECT branch_id FROM session_branches WHERE root_id = ?)", [new Date().toISOString(), new Date().toISOString(), id, id]);
    });
  }

  /**
   * v2.4 §13.1 补强：彻底删除——物理清除会话及其消息、运行、工具调用、审计与证据行。
   * 与软删除互补：软删除保留审计可回溯，彻底删除不可恢复。幂等（不存在时不报错）。
   * 证据行先删（evidence.run_id 外键指向 runs），其余按会话维度删除。
   */
  async purge(id: SessionId): Promise<void> {
    this.driver.transaction(() => {
      const descendants = this.driver.rows("SELECT branch_id FROM session_branches WHERE root_id = ?", [id]);
      this.driver.exec("DELETE FROM session_branches WHERE root_id = ?", [id]);
      for (const row of descendants) this.purgeStorage(String(row.branch_id));
      this.purgeStorage(id);
    });
  }

  private purgeStorage(id: string): void {
      this.driver.exec("DELETE FROM public_assistant_outcomes WHERE session_id = ?", [id]);
      this.driver.exec("DELETE FROM run_questions WHERE session_id = ?", [id]);
    this.driver.exec("DELETE FROM run_public_plans WHERE run_id IN (SELECT run_id FROM runs WHERE session_id = ?)", [id]);
      this.driver.exec("DELETE FROM evidence WHERE run_id IN (SELECT run_id FROM runs WHERE session_id = ?)", [id]);
      this.driver.exec("DELETE FROM tool_calls WHERE session_id = ?", [id]);
      this.driver.exec("DELETE FROM tool_audit WHERE session_id = ?", [id]);
      this.driver.exec("DELETE FROM turn_results WHERE session_id = ?", [id]);
      // v2.5 §11.1：压缩记录随会话物理清除（模型能力/校准是全局数据，不在此列）。
      this.driver.exec("DELETE FROM session_compactions WHERE session_id = ?", [id]);
      // v2.14 §22：请求用量遥测随会话物理清除（软删除时保留，供审计回溯）。
      this.driver.exec("DELETE FROM assistant_requests WHERE session_id = ?", [id]);
      this.driver.exec("DELETE FROM run_requests WHERE session_id = ?", [id]);
      this.driver.exec("DELETE FROM runs WHERE session_id = ?", [id]);
      this.driver.exec("DELETE FROM session_events WHERE session_id = ?", [id]);
      this.driver.exec("DELETE FROM sessions WHERE session_id = ?", [id]);
  }

  async append(id: SessionId, message: AgentMessage): Promise<void> {
    const now = new Date().toISOString();
    this.driver.transaction(() => {
      const exists = this.driver.rows("SELECT session_id FROM sessions WHERE session_id = ?", [id]);
      if (!exists.length) throw new Error(`会话不存在: ${id}`);
      const seqRow = this.driver.rows("SELECT COALESCE(MAX(sequence_no), 0) AS sequence_no FROM session_events WHERE session_id = ?", [id]);
      const seq = Number(seqRow[0]?.sequence_no ?? 0) + 1;
      this.driver.exec(
        "INSERT INTO session_events(event_id, session_id, sequence_no, message_type, payload_json, created_at) VALUES(?,?,?,?,?,?)",
        [randomUUID(), id, seq, message.type, JSON.stringify(message), message.createdAt],
      );
      this.driver.exec("UPDATE sessions SET updated_at = ? WHERE session_id = ? OR session_id = (SELECT root_id FROM session_branches WHERE branch_id = ?)", [now, id, id]);
    });
  }

  async setStatus(id: SessionId, status: SessionStatus): Promise<void> {
    this.driver.transaction(() => {
      const exists = this.driver.rows("SELECT session_id FROM sessions WHERE session_id = ?", [id]);
      if (!exists.length) throw new Error(`会话不存在: ${id}`);
      this.driver.exec("UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?", [status, new Date().toISOString(), id]);
    });
  }

  /** v2.2 §10.1：设置会话审核档位；作用于下一轮起（不打断运行中的轮次）。 */
  async setReviewLevel(id: SessionId, level: ReviewLevel): Promise<void> {
    this.driver.transaction(() => {
      const exists = this.driver.rows("SELECT session_id FROM sessions WHERE session_id = ?", [id]);
      if (!exists.length) throw new Error(`会话不存在: ${id}`);
      this.driver.exec("UPDATE sessions SET review_level = ?, updated_at = ? WHERE session_id = ?", [level, new Date().toISOString(), id]);
    });
  }

  /** v2.16 §11.3：设置会话默认预算档位（Run 入列时仍可按显式参数覆盖）。 */
  async setBudgetTier(id: SessionId, tier: "simple" | "comparison" | "deep"): Promise<void> {
    this.driver.transaction(() => {
      const exists = this.driver.rows("SELECT session_id FROM sessions WHERE session_id = ?", [id]);
      if (!exists.length) throw new Error(`会话不存在: ${id}`);
      this.driver.exec("UPDATE sessions SET budget_tier = ?, updated_at = ? WHERE session_id = ?", [tier, new Date().toISOString(), id]);
    });
  }

  /** 请求幂等：保存 turn 结果；同 requestId 重复请求返回既有结果（T12）。 */
  async saveTurnResult(sessionId: SessionId, requestId: string, result: unknown): Promise<void> {
    this.driver.exec(
      "INSERT OR IGNORE INTO turn_results(session_id, request_id, result_json, created_at) VALUES(?,?,?,?)",
      [sessionId, requestId, JSON.stringify(result), new Date().toISOString()],
    );
  }

  async loadTurnResult(sessionId: SessionId, requestId: string): Promise<unknown | null> {
    const row = this.driver.rows("SELECT result_json FROM turn_results WHERE session_id = ? AND request_id = ?", [sessionId, requestId])[0] as
      | { result_json: string }
      | undefined;
    return row ? JSON.parse(row.result_json) : null;
  }
}
