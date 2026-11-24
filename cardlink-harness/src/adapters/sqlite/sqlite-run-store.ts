import type { RunPhase, RunRecord, RunStatus, RunStore, ToolCallRecord, ToolCallWriteOutcome } from "../../application/ports/run-store.ts";
import type { FinishReason } from "../../domain/finish-reason.ts";
import type { TokenUsage } from "../../domain/token-usage.ts";
import type { SqlDriver } from "../sqlite/db.ts";

interface RunRow {
  run_id: string;
  session_id: string;
  snapshot_id: string;
  request_id: string;
  status: string;
  phase: string;
  iteration: number;
  last_error: string | null;
  result_json: string | null;
  finish_reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  usage_estimated: number | null;
  budget_tier: string | null;
  created_at: string;
  updated_at: string;
}

interface ToolCallRow {
  session_id: string;
  tool_call_id: string;
  run_id: string;
  tool_name: string;
  args_hash: string;
  policy_status: string;
  reviewer_approved: number | null;
  reviewer_reason: string | null;
  execution_status: string;
  result_json: string | null;
  evidence_json: string | null;
  updated_at: string;
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    snapshotId: row.snapshot_id,
    requestId: row.request_id,
    status: row.status as RunStatus,
    phase: row.phase as RunPhase,
    iteration: row.iteration,
    lastError: row.last_error ?? undefined,
    resultJson: row.result_json ?? undefined,
    finishReason: (row.finish_reason as FinishReason | null) ?? undefined,
    budgetTier: row.budget_tier === "simple" || row.budget_tier === "comparison" || row.budget_tier === "deep"
      ? row.budget_tier
      : undefined,
    usage:
      row.total_tokens === null && row.prompt_tokens === null && row.completion_tokens === null
        ? undefined
        : {
            promptTokens: row.prompt_tokens ?? undefined,
            completionTokens: row.completion_tokens ?? undefined,
            totalTokens: row.total_tokens ?? undefined,
            estimated: row.usage_estimated === 1,
          },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toToolCallRecord(row: ToolCallRow): ToolCallRecord {
  return {
    sessionId: row.session_id,
    toolCallId: row.tool_call_id,
    runId: row.run_id,
    toolName: row.tool_name,
    argsHash: row.args_hash,
    policyStatus: row.policy_status as ToolCallRecord["policyStatus"],
    reviewerApproved: row.reviewer_approved === null ? undefined : row.reviewer_approved === 1,
    reviewerReason: row.reviewer_reason ?? undefined,
    executionStatus: row.execution_status as ToolCallRecord["executionStatus"],
    resultJson: row.result_json ?? undefined,
    evidenceJson: row.evidence_json ?? undefined,
    updatedAt: row.updated_at,
  };
}

export class SqliteRunStore implements RunStore {
  constructor(private readonly driver: SqlDriver) {}

  startRun(runId: string, sessionId: string, snapshotId: string, requestId: string, budgetTier?: "simple" | "comparison" | "deep"): RunRecord {
    return this.driver.transaction(() => {
      const previous = this.findByRequest(sessionId, requestId);
      if (previous) return previous;
      const now = new Date().toISOString();
      this.driver.exec(
        "INSERT INTO runs(run_id, session_id, snapshot_id, request_id, status, phase, iteration, budget_tier, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [runId, sessionId, snapshotId, requestId, "active", "created", 0, budgetTier ?? null, now, now],
      );
      this.driver.exec("INSERT INTO run_requests(session_id, request_id, run_id) VALUES(?,?,?)", [sessionId, requestId, runId]);
      return this.get(runId)!;
    });
  }

  findByRequest(sessionId: string, requestId: string): RunRecord | null {
    const row = this.driver.rows(
      "SELECT r.* FROM run_requests q JOIN runs r ON r.run_id = q.run_id WHERE q.session_id = ? AND q.request_id = ?",
      [sessionId, requestId],
    )[0] as unknown as RunRow | undefined;
    return row ? toRunRecord(row) : null;
  }

  setPhase(runId: string, phase: RunPhase, iteration?: number, lastError?: string): void {
    this.driver.exec(
      "UPDATE runs SET phase = ?, iteration = COALESCE(?, iteration), last_error = COALESCE(?, last_error), updated_at = ? WHERE run_id = ?",
      [phase, iteration ?? null, lastError ?? null, new Date().toISOString(), runId],
    );
  }

  finish(runId: string, status: RunStatus, phase: RunPhase, resultJson?: string, lastError?: string, finishReason?: FinishReason): void {
    this.driver.exec(
      "UPDATE runs SET status = ?, phase = ?, result_json = COALESCE(?, result_json), last_error = COALESCE(?, last_error), finish_reason = COALESCE(?, finish_reason), updated_at = ? WHERE run_id = ?",
      [status, phase, resultJson ?? null, lastError ?? null, finishReason ?? null, new Date().toISOString(), runId],
    );
  }

  /** v2.5 §5.2：用量落库（累计值由调用方求和后写入）。 */
  setUsage(runId: string, usage: TokenUsage): void {
    this.driver.exec(
      "UPDATE runs SET prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, usage_estimated = ?, updated_at = ? WHERE run_id = ?",
      [
        usage.promptTokens ?? null,
        usage.completionTokens ?? null,
        usage.totalTokens ?? null,
        usage.estimated ? 1 : 0,
        new Date().toISOString(),
        runId,
      ],
    );
  }

  get(runId: string): RunRecord | null {
    const row = this.driver.rows("SELECT * FROM runs WHERE run_id = ?", [runId])[0] as unknown as RunRow | undefined;
    return row ? toRunRecord(row) : null;
  }

  findActiveBySession(sessionId: string): RunRecord | null {
    const row = this.driver
      .rows("SELECT * FROM runs WHERE session_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", [sessionId])[0] as unknown as RunRow | undefined;
    return row ? toRunRecord(row) : null;
  }

  /** v2.16 §11.3：最近一次 Run（含已结束），供续答沿用档位。 */
  latestBySession(sessionId: string): RunRecord | null {
    const row = this.driver
      .rows("SELECT * FROM runs WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [sessionId])[0] as unknown as RunRow | undefined;
    return row ? toRunRecord(row) : null;
  }

  recordToolCall(entry: ToolCallRecord): ToolCallWriteOutcome {
    const existing = this.driver.rows(
      "SELECT * FROM tool_calls WHERE session_id = ? AND tool_call_id = ?",
      [entry.sessionId, entry.toolCallId],
    )[0] as unknown as ToolCallRow | undefined;
    if (existing) {
      return existing.args_hash === entry.argsHash ? "recorded" : "conflict";
    }
    this.driver.exec(
      "INSERT INTO tool_calls(session_id, tool_call_id, run_id, tool_name, args_hash, policy_status, reviewer_approved, reviewer_reason, execution_status, result_json, evidence_json, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        entry.sessionId, entry.toolCallId, entry.runId, entry.toolName, entry.argsHash,
        entry.policyStatus, entry.reviewerApproved === undefined ? null : entry.reviewerApproved ? 1 : 0,
        entry.reviewerReason ?? null, entry.executionStatus,
        entry.resultJson ?? null, entry.evidenceJson ?? null, entry.updatedAt,
      ],
    );
    return "recorded";
  }

  getToolCall(sessionId: string, toolCallId: string): ToolCallRecord | null {
    const row = this.driver
      .rows("SELECT * FROM tool_calls WHERE session_id = ? AND tool_call_id = ?", [sessionId, toolCallId])[0] as unknown as ToolCallRow | undefined;
    return row ? toToolCallRecord(row) : null;
  }

  listToolCalls(runId: string): ToolCallRecord[] {
    const rows = this.driver.rows("SELECT * FROM tool_calls WHERE run_id = ? ORDER BY updated_at ASC", [runId]) as unknown as ToolCallRow[];
    return rows.map(toToolCallRecord);
  }
}
