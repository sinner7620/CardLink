import { randomUUID } from "../platform/uuid.ts";
import type { ModelRoleSetting } from "./provider.ts";
import type { AgentMessage, ISODateTime } from "./message.ts";

export type SessionId = string;

export type SessionScope = {
  notebookIds: string[];
  subject?: string;
};

export type SessionStatus = "active" | "interrupted" | "completed";

/**
 * v2.2 §10.1 审核档位（会话属性）：strict=全双审；provenance=溯源下钻免审（默认）；
 * full_allow=仅确定性门。只决定 Reviewer 是否参与，不改变任何确定性检查与审计。
 */
export type ReviewLevel = "strict" | "provenance" | "full_allow";

export const DEFAULT_REVIEW_LEVEL: ReviewLevel = "provenance";

export function validateReviewLevel(level: unknown): { ok: true; level: ReviewLevel } | { ok: false; reason: string } {
  if (level !== "strict" && level !== "provenance" && level !== "full_allow") {
    return { ok: false, reason: `reviewLevel 必须是 strict/provenance/full_allow，收到 ${String(level)}` };
  }
  return { ok: true, level };
}

export type Session = {
  id: SessionId;
  messages: AgentMessage[];
  /** 共享前缀中消息的来源会话，仅用于本地审计和证据定位。 */
  sharedMessageOwners?: Record<string, SessionId>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  scope: SessionScope;
  snapshotId?: string;
  status: SessionStatus;
  assistantModel?: ModelRoleSetting;
  /** v2.2 §10.1：未设置时按 DEFAULT_REVIEW_LEVEL 读取（旧会话兼容）。 */
  reviewLevel?: ReviewLevel;
  /** v2.4 §13.1：用户可见标题；未设置时 UI 显示时间/摘要兜底。 */
  title?: string;
  /** v2.4 §13.1：软删除时间戳；缺失/NULL = 未删除。审计/证据/运行行不随删除丢失。 */
  deletedAt?: ISODateTime;
  /** v2.16 §11.3：会话默认运行预算档位（UI 选中状态）；缺失按简单档显示。 */
  budgetTier?: "simple" | "comparison" | "deep";
};

/** v2.4 §13.1：标题校验——去首尾空白后 1..128 字符。 */
export function validateSessionTitle(title: unknown): { ok: true; title: string } | { ok: false; reason: string } {
  if (typeof title !== "string") return { ok: false, reason: "标题必须是字符串" };
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, reason: "标题不能为空" };
  if (trimmed.length > 128) return { ok: false, reason: "标题超过最大长度 128" };
  return { ok: true, title: trimmed };
}

export function newSessionId(): string {
  return randomUUID();
}

export function validateSessionScope(scope: unknown): { ok: true; scope: SessionScope } | { ok: false; reason: string } {
  if (scope === null || typeof scope !== "object") return { ok: false, reason: "scope 必须是对象" };
  const s = scope as { notebookIds?: unknown; subject?: unknown };
  if (!Array.isArray(s.notebookIds)) return { ok: false, reason: "scope.notebookIds 必须是字符串数组" };
  if (s.notebookIds.length > 64) return { ok: false, reason: "scope.notebookIds 数量过多" };
  for (const id of s.notebookIds) {
    if (typeof id !== "string" || !id.trim() || id.length > 128) {
      return { ok: false, reason: "scope.notebookIds 含非法 ID" };
    }
  }
  if (s.subject !== undefined && (typeof s.subject !== "string" || s.subject.length > 64)) {
    return { ok: false, reason: "scope.subject 非法" };
  }
  const checked: SessionScope = { notebookIds: [...(s.notebookIds as string[])] };
  if (typeof s.subject === "string" && s.subject.trim()) checked.subject = s.subject.trim();
  return { ok: true, scope: checked };
}
