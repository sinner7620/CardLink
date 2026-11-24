import type { PolicyStatus, ExecutionStatus } from "./audit-log.ts";
import type { FinishReason } from "../../domain/finish-reason.ts";
import type { TokenUsage } from "../../domain/token-usage.ts";

/** v2.1 §11 RunPhase 状态机（子集：cancelled 归入 interrupted 终态的 status 维度）。 */
export type RunPhase =
  | "created"
  | "assistant_pending"
  | "review_pending"
  | "tool_pending"
  | "tool_completed"
  | "final_pending"
  | "finished"
  | "interrupted"
  | "failed";

export type RunStatus = "active" | "finished" | "interrupted" | "failed" | "cancelled";

export type RunRecord = {
  runId: string;
  sessionId: string;
  snapshotId: string;
  requestId: string;
  status: RunStatus;
  phase: RunPhase;
  iteration: number;
  lastError?: string;
  resultJson?: string;
  /** v2.4 §11.1：轮次终止原因（迁移 v9 落库；旧记录缺失按 undefined）。 */
  finishReason?: FinishReason;
  /** v2.5 §5.2：最近一次记录的 token 用量（迁移 v10；旧记录缺失）。 */
  usage?: TokenUsage;
  /** v2.16 §11.3：Run 入列时固定的预算档位（迁移 v14；NULL = 未选档旧调用）。 */
  budgetTier?: "simple" | "comparison" | "deep";
  createdAt: string;
  updatedAt: string;
};

export type ToolCallRecord = {
  sessionId: string;
  toolCallId: string;
  runId: string;
  toolName: string;
  argsHash: string;
  policyStatus: PolicyStatus;
  reviewerApproved?: boolean;
  reviewerReason?: string;
  executionStatus: ExecutionStatus;
  resultJson?: string;
  evidenceJson?: string;
  updatedAt: string;
};

export type ToolCallWriteOutcome = "recorded" | "conflict";

/**
 * v2.1 §11：Run 检查点持久化。
 * tool_calls 主键 (session_id, tool_call_id)；argsHash 不一致时返回 conflict，
 * 不得复用不同操作的旧结果（幂等冲突，§5）。
 */
export interface RunStore {
  /** @param budgetTier v2.16 §11.3：Run 入列时固定的档位（可选；不传 = 未选档旧调用）。 */
  startRun(runId: string, sessionId: string, snapshotId: string, requestId: string, budgetTier?: "simple" | "comparison" | "deep"): RunRecord;
  findByRequest(sessionId: string, requestId: string): RunRecord | null;
  /** v2.16 §11.3：会话最近一次 Run（续答未显式选档时沿用其档位）。 */
  latestBySession?(sessionId: string): RunRecord | null;
  setPhase(runId: string, phase: RunPhase, iteration?: number, lastError?: string): void;
  /** v2.4：可选 finishReason 随终态落库（runs.finish_reason，迁移 v9）。 */
  finish(runId: string, status: RunStatus, phase: RunPhase, resultJson?: string, lastError?: string, finishReason?: FinishReason): void;
  /** v2.5 §5.2：运行中/终态记录 token 用量（迁移 v10；`estimated` 如实落库）。 */
  setUsage(runId: string, usage: TokenUsage): void;
  get(runId: string): RunRecord | null;
  findActiveBySession(sessionId: string): RunRecord | null;
  recordToolCall(entry: ToolCallRecord): ToolCallWriteOutcome;
  getToolCall(sessionId: string, toolCallId: string): ToolCallRecord | null;
  listToolCalls(runId: string): ToolCallRecord[];
}
