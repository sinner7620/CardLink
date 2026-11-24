import type { ModelRoleSetting } from "../../src/domain/provider.ts";
import type { AgentMessage } from "../../src/domain/message.ts";
import type { ReviewLevel, Session, SessionId, SessionStatus } from "../../src/domain/session.ts";
import type { SessionStore, SessionSummary } from "../../src/application/ports/session-store.ts";
import type { AuditLog, ToolAudit } from "../../src/application/ports/audit-log.ts";

/** 内存 FakeStore（T17）：与 SqliteSessionStore 同契约，AgentService 测试可互换。 */
export class InMemorySessionStore implements SessionStore {
  readonly sessions = new Map<SessionId, Session>();

  async create(session: Session): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async bindInitialAssistant(id: SessionId, setting: ModelRoleSetting): Promise<void> {
    const session = this.sessions.get(id);
    if (session && !session.assistantModel) session.assistantModel = { ...setting };
  }

  async setAssistantModel(id: SessionId, setting: ModelRoleSetting): Promise<void> {
    const session = this.sessions.get(id);
    if (session && !session.deletedAt) session.assistantModel = { ...setting };
  }

  async get(id: SessionId): Promise<Session | null> {
    const s = this.sessions.get(id);
    return s ? structuredClone(s) : null;
  }

  async list(limit: number, cursor?: string): Promise<Session[]> {
    const all = [...this.sessions.values()]
      .filter((s) => !s.deletedAt)
      .sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      );
    const start = cursor ? all.findIndex((s) => s.id === cursor) + 1 : 0;
    return all.slice(start, start + limit);
  }

  async append(id: SessionId, message: AgentMessage): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`会话不存在: ${id}`);
    s.messages.push(structuredClone(message));
    s.updatedAt = new Date().toISOString();
  }

  async setStatus(id: SessionId, status: SessionStatus): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`会话不存在: ${id}`);
    s.status = status;
  }

  async setReviewLevel(id: SessionId, level: ReviewLevel): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`会话不存在: ${id}`);
    s.reviewLevel = level;
  }

  /** v2.4 §13.1：摘要列表（与 SqliteSessionStore 同语义：过滤删除、updatedAt 倒序、query 匹配）。 */
  async listSummaries(limit: number, query?: string): Promise<SessionSummary[]> {
    const capped = Math.max(1, Math.min(200, Math.floor(limit)));
    const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
    const all = [...this.sessions.values()]
      .filter((s) => !s.deletedAt)
      .map((s) => this.summaryOf(s));
    const matched = needle
      ? all.filter((s) => {
          const title = (s.title ?? "").toLowerCase();
          const preview = (s.lastPreview ?? "").toLowerCase();
          return title.includes(needle) || preview.includes(needle);
        })
      : all;
    matched.sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
    );
    return matched.slice(0, capped);
  }

  private summaryOf(s: Session): SessionSummary {
    const firstUser = s.messages.find((m): m is Extract<AgentMessage, { type: "user" }> => m.type === "user");
    return {
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      status: s.status,
      reviewLevel: s.reviewLevel,
      snapshotId: s.snapshotId,
      messageCount: s.messages.length,
      lastPreview: firstUser?.text.trim().slice(0, 80) || undefined,
    };
  }

  async rename(id: SessionId, title: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`会话不存在: ${id}`);
    s.title = title;
    s.updatedAt = new Date().toISOString();
  }

  /** v2.4 §13.1：软删除（幂等）。 */
  async softDelete(id: SessionId): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`会话不存在: ${id}`);
    s.deletedAt = s.deletedAt ?? new Date().toISOString();
    s.updatedAt = new Date().toISOString();
  }

  /** v2.4 §13.1 补强：彻底删除（幂等）。 */
  async purge(id: SessionId): Promise<void> {
    this.sessions.delete(id);
    for (const key of [...this.turnResults.keys()]) {
      if (key.startsWith(`${id}|`)) this.turnResults.delete(key);
    }
  }

  async saveTurnResult(sessionId: SessionId, requestId: string, result: unknown): Promise<void> {
    const key = `${sessionId}|${requestId}`;
    if (!this.turnResults.has(key)) {
      // 与 SQLite INSERT OR IGNORE 一致：首次结果生效（T12 幂等）。
      this.turnResults.set(key, structuredClone(result));
    }
  }

  async loadTurnResult(sessionId: SessionId, requestId: string): Promise<unknown | null> {
    const r = this.turnResults.get(`${sessionId}|${requestId}`);
    return r === undefined ? null : structuredClone(r);
  }

  readonly turnResults = new Map<string, unknown>();
}

/** 内存审计（T17/T03）：记录全部审计行供断言。 */
export class InMemoryAuditLog implements AuditLog {
  readonly rows: ToolAudit[] = [];

  async record(decision: ToolAudit): Promise<void> {
    this.rows.push(structuredClone(decision));
  }

  byToolCallId(toolCallId: string): ToolAudit[] {
    return this.rows.filter((r) => r.toolCallId === toolCallId);
  }
}
