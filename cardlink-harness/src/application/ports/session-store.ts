import { decodeBase64Url, encodeBase64Url, utf8Decode } from "../../platform/base64url.ts";
import { utf8Bytes } from "../../platform/sha256.ts";
import type { ModelRoleSetting } from "../../domain/provider.ts";
import type { AgentMessage, ISODateTime } from "../../domain/message.ts";
import type { ReviewLevel, Session, SessionId, SessionStatus } from "../../domain/session.ts";

/** §5 冻结端口：每条消息追加式持久化。 */
export interface SessionStore {
  branchView?(rootId: SessionId, branchId?: SessionId): SessionBranchView;
  fork?(rootId: SessionId, fromId: SessionId, anchorId: string, operation: BranchOperation, requestId: string): SessionBranchView;
  selectBranch?(rootId: SessionId, branchId: SessionId): SessionBranchView;
  create(session: Session): Promise<void>;
  get(id: SessionId): Promise<Session | null>;
  list(limit: number, cursor?: string): Promise<Session[]>;
  append(id: SessionId, message: AgentMessage): Promise<void>;
  setStatus(id: SessionId, status: SessionStatus): Promise<void>;
  bindInitialAssistant(id: SessionId, setting: ModelRoleSetting): Promise<void>;
  setAssistantModel(id: SessionId, setting: ModelRoleSetting): Promise<void>;
  /** v2.2 §10.1：设置会话审核档位；下一轮起生效。 */
  setReviewLevel(id: SessionId, level: ReviewLevel): Promise<void>;
  /** v2.16 §11.3：设置会话默认运行预算档位（UI 选中状态；Run 入列时仍可覆盖）。 */
  setBudgetTier?(id: SessionId, tier: "simple" | "comparison" | "deep"): Promise<void>;
  // v2.4 §13.1 加法扩展：
  /** 摘要列表（不加载消息体）；query 非空时按标题与首条用户消息预览匹配；按 updatedAt 倒序。 */
  listSummaries(limit: number, query?: string): Promise<SessionSummary[]>;
  rename(id: SessionId, title: string): Promise<void>;
  /** 软删除：置 deletedAt，不物理删除任何行。 */
  softDelete(id: SessionId): Promise<void>;
  /**
   * v2.4 §13.1 补强：彻底删除——物理清除该会话的消息/运行/工具调用/审计/证据行。
   * 不可恢复；软删除后的会话也可彻底删除。幂等（已不存在时按成功处理）。
   */
  purge(id: SessionId): Promise<void>;
}

export type BranchOperation = "edit" | "regenerate";

export type SessionBranch = {
  id: SessionId;
  parentId?: SessionId;
  anchorId?: string;
  operation?: BranchOperation;
};

export type SessionBranchView = {
  sessionId: SessionId;
  branchId: SessionId;
  branches: SessionBranch[];
};

/** v2.4 §13.1：会话摘要（列表/搜索用；不含消息体）。 */
export type SessionSummary = {
  id: SessionId;
  title?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  status: SessionStatus;
  reviewLevel?: ReviewLevel;
  budgetTier?: "simple" | "comparison" | "deep";
  snapshotId?: string;
  messageCount: number;
  /** 首条用户消息预览（≤80 字符）；无用户消息时缺失。 */
  lastPreview?: string;
};

export function encodeCursor(session: Session): string {
  return encodeBase64Url(utf8Bytes(`${session.createdAt}|${session.id}`));
}

export function decodeCursor(cursor: string): { createdAt: ISODateTime; id: SessionId } | null {
  try {
    const raw = utf8Decode(decodeBase64Url(cursor));
    const sep = raw.lastIndexOf("|");
    if (sep <= 0) return null;
    const createdAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
