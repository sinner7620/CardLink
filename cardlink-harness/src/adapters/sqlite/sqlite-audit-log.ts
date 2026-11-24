import { randomUUID } from "../../platform/uuid.ts";
import type { AgentMessage } from "../../domain/message.ts";
import type { SessionId } from "../../domain/session.ts";
import type {
  AuditLog,
  ExecutionStatus,
  PolicyStatus,
  ToolAudit,
  TransactionalAuditLog,
} from "../../application/ports/audit-log.ts";
import { newAuditId } from "../../application/ports/audit-log.ts";
import type { SqlDriver } from "./db.ts";

interface AuditRow {
  audit_id: string;
  session_id: string;
  tool_call_id: string;
  tool_name: string;
  policy_status: string;
  reviewer_approved: number | null;
  reviewer_reason: string | null;
  execution_status: string;
  args_summary: string | null;
  created_at: string;
}

function insertAudit(driver: SqlDriver, audit: ToolAudit): void {
  driver.exec(
    "INSERT INTO tool_audit(audit_id, session_id, tool_call_id, tool_name, policy_status, reviewer_approved, reviewer_reason, execution_status, args_summary, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    [
      audit.auditId,
      audit.sessionId,
      audit.toolCallId,
      audit.toolName,
      audit.policyStatus,
      audit.reviewerApproved === undefined ? null : audit.reviewerApproved ? 1 : 0,
      audit.reviewerReason ?? null,
      audit.executionStatus,
      audit.argsSummary ?? null,
      audit.createdAt,
    ],
  );
}

function insertEvent(driver: SqlDriver, sessionId: SessionId, message: AgentMessage): void {
  const seqRow = driver.rows("SELECT COALESCE(MAX(sequence_no), 0) AS sequence_no FROM session_events WHERE session_id = ?", [sessionId]);
  const seq = Number(seqRow[0]?.sequence_no ?? 0) + 1;
  driver.exec(
    "INSERT INTO session_events(event_id, session_id, sequence_no, message_type, payload_json, created_at) VALUES(?,?,?,?,?,?)",
    [randomUUID(), sessionId, seq, message.type, JSON.stringify(message), message.createdAt],
  );
  driver.exec("UPDATE sessions SET updated_at = ? WHERE session_id = ?", [new Date().toISOString(), sessionId]);
}

/**
 * 审计日志（§7 tool_audit）。recordAndAppend 在同一事务内写入审计与工具结果，
 * 保证 §10.2 要求的原子性（T12：不产生重复终结结果）。
 */
export class SqliteAuditLog implements TransactionalAuditLog {
  constructor(private readonly driver: SqlDriver) {}

  async record(decision: ToolAudit): Promise<void> {
    insertAudit(this.driver, decision);
  }

  async recordAndAppend(decision: ToolAudit, sessionId: SessionId, message: AgentMessage): Promise<void> {
    this.driver.transaction(() => {
      insertAudit(this.driver, decision);
      insertEvent(this.driver, sessionId, message);
    });
  }

  /** 诊断用：按会话列出审计行。 */
  listBySession(sessionId: SessionId): Array<{ toolCallId: string; policyStatus: PolicyStatus; executionStatus: ExecutionStatus; reviewerApproved?: boolean }> {
    const rows = this.driver.rows("SELECT * FROM tool_audit WHERE session_id = ? ORDER BY created_at ASC", [sessionId]) as unknown as AuditRow[];
    return rows.map((r) => ({
      toolCallId: r.tool_call_id,
      policyStatus: r.policy_status as PolicyStatus,
      executionStatus: r.execution_status as ExecutionStatus,
      reviewerApproved: r.reviewer_approved === null ? undefined : r.reviewer_approved === 1,
    }));
  }
}

export { newAuditId };
