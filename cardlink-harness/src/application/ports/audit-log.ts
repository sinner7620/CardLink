import type { AgentMessage, ISODateTime } from "../../domain/message.ts";
import { randomUUID } from "../../platform/uuid.ts";
import type { SessionId } from "../../domain/session.ts";

export type PolicyStatus =
  | "pass"
  | "unknown_tool"
  | "invalid_args"
  | "scope_escape"
  | "limit_exceeded";

export type ExecutionStatus =
  | "executed"
  | "denied"
  | "not_executed"
  | "timeout"
  | "error";

export type ToolAudit = {
  auditId: string;
  sessionId: SessionId;
  toolCallId: string;
  toolName: string;
  policyStatus: PolicyStatus;
  /** Reviewer 未参与时为 undefined（确定性拒绝路径）。 */
  reviewerApproved?: boolean;
  reviewerReason?: string;
  executionStatus: ExecutionStatus;
  /** 必要参数摘要：仅结构信息，不含 OCR 正文与完整敏感数据（§11）。 */
  argsSummary?: string;
  createdAt: ISODateTime;
};

/** §5 端口：审核记录入审计日志。 */
export interface AuditLog {
  record(decision: ToolAudit): Promise<void>;
}

/**
 * 可选能力扩展：同一 SQLite 连接上原子持久化审计与工具结果（§10.2 persistAuditAndResult）。
 * 应用层通过 duck-typing 检测该能力；不存在时退化为顺序写入。
 */
export interface TransactionalAuditLog extends AuditLog {
  recordAndAppend(decision: ToolAudit, sessionId: SessionId, message: AgentMessage): Promise<void>;
}

export function isTransactionalAuditLog(a: AuditLog): a is TransactionalAuditLog {
  return typeof (a as TransactionalAuditLog).recordAndAppend === "function";
}

export function newAuditId(): string {
  return randomUUID();
}

/** 参数摘要：只保留结构键与短标量值，丢弃任何长文本。 */
export function summarizeArgs(args: unknown): string | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v === "string") parts.push(`${k}=s(${v.length})`);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(`${k}=${v}`);
    else if (Array.isArray(v)) parts.push(`${k}=arr(${v.length})`);
    else if (v !== undefined) parts.push(`${k}=obj`);
  }
  return parts.length ? parts.join(",") : undefined;
}
