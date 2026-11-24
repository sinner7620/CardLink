import type {
  CurrencyCostGroup,
  RequestTelemetryKey,
  RequestTelemetryPatch,
  RequestTelemetryStore,
  SessionUsageSummary,
} from "../../application/ports/request-telemetry-store.ts";
import type {
  AssistantRequestRecord,
  RequestCompactionLink,
  RequestOutcome,
  RequestTokenBreakdown,
  RequestUsageSource,
} from "../../domain/request-telemetry.ts";
import type { FinishReason } from "../../domain/finish-reason.ts";
import type { SqlDriver } from "./db.ts";
import type { SqlValue } from "./driver.ts";

interface RequestRow {
  session_id: string;
  run_id: string;
  request_seq: number | string;
  attempt: number | string;
  provider_id: string;
  model_id: string;
  outcome: string;
  finish_reason: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  instruction_tokens: number | string;
  compaction_tokens: number | string;
  tool_definition_tokens: number | string;
  message_tokens: number | string;
  tool_result_tokens: number | string;
  overhead_tokens: number | string;
  input_total_tokens: number | string;
  input_budget_tokens: number | string;
  output_budget_tokens: number | string;
  reserved_tokens: number | string;
  compaction_trigger_tokens: number | string;
  compaction_id: string | null;
  compaction_applied: number | string;
  compaction_trigger_reason: string | null;
  prompt_tokens: number | string | null;
  prompt_source: string | null;
  completion_tokens: number | string | null;
  completion_source: string | null;
  reported_prompt_tokens: number | string | null;
  reported_completion_tokens: number | string | null;
  usage_estimated: number | string;
  rate_currency: string | null;
  rate_input_per_million: number | string | null;
  rate_output_per_million: number | string | null;
  rate_updated_at: string | null;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNum(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sourceOf(value: unknown): RequestUsageSource | undefined {
  return value === "provider" || value === "estimated" ? value : undefined;
}

function breakdownOf(row: RequestRow): RequestTokenBreakdown {
  return {
    instructionTokens: num(row.instruction_tokens),
    compactionTokens: num(row.compaction_tokens),
    toolDefinitionTokens: num(row.tool_definition_tokens),
    messageTokens: num(row.message_tokens),
    toolResultTokens: num(row.tool_result_tokens),
    overheadTokens: num(row.overhead_tokens),
    totalTokens: num(row.input_total_tokens),
  };
}

function compactionOf(row: RequestRow): RequestCompactionLink | null {
  if (!row.compaction_id && num(row.compaction_applied) !== 1) return null;
  const reason = row.compaction_trigger_reason;
  return {
    id: row.compaction_id ?? undefined,
    applied: num(row.compaction_applied) === 1,
    triggerReason: reason === "budget" || reason === "context_limit" ? reason : undefined,
  };
}

function toRecord(row: RequestRow): AssistantRequestRecord {
  return {
    sessionId: row.session_id,
    runId: row.run_id,
    requestSeq: num(row.request_seq),
    attempt: Math.max(1, num(row.attempt)),
    providerId: row.provider_id,
    modelId: row.model_id,
    createdAt: row.created_at,
    outcome: row.outcome as RequestOutcome,
    finishReason: (row.finish_reason as FinishReason | null) ?? undefined,
    errorCode: row.error_code ?? undefined,
    breakdown: breakdownOf(row),
    budget: {
      inputBudgetTokens: num(row.input_budget_tokens),
      outputBudgetTokens: num(row.output_budget_tokens),
      reservedTokens: num(row.reserved_tokens),
      compactionTriggerTokens: num(row.compaction_trigger_tokens),
    },
    compaction: compactionOf(row),
    promptTokens: optionalNum(row.prompt_tokens),
    promptSource: sourceOf(row.prompt_source),
    completionTokens: optionalNum(row.completion_tokens),
    completionSource: sourceOf(row.completion_source),
    reportedPromptTokens: optionalNum(row.reported_prompt_tokens),
    reportedCompletionTokens: optionalNum(row.reported_completion_tokens),
    usageEstimated: num(row.usage_estimated) === 1,
    rate:
      row.rate_currency && row.rate_input_per_million !== null && row.rate_output_per_million !== null
        ? {
            currency: row.rate_currency,
            inputPerMillion: num(row.rate_input_per_million),
            outputPerMillion: num(row.rate_output_per_million),
            updatedAt: row.rate_updated_at ?? "",
          }
        : null,
  };
}

/**
 * v2.14 §22：请求用量遥测持久化。
 *
 * 幂等键 `(session_id, run_id, request_seq)`；索引按会话倒序遍历，
 * 查询全部有界（分页 + 近期窗口），不扫描整库。
 */
export class SqliteRequestTelemetryStore implements RequestTelemetryStore {
  constructor(private readonly driver: SqlDriver) {}

  insertIfAbsent(record: AssistantRequestRecord): boolean {
    return this.driver.transaction(() => {
      const existing = this.driver.rows(
        "SELECT 1 AS present FROM assistant_requests WHERE session_id = ? AND run_id = ? AND request_seq = ?",
        [record.sessionId, record.runId, record.requestSeq],
      );
      if (existing.length) return false;
      this.driver.exec(
        `INSERT INTO assistant_requests(
           session_id, run_id, request_seq, attempt, provider_id, model_id, outcome, finish_reason, error_code,
           created_at, updated_at,
           instruction_tokens, compaction_tokens, tool_definition_tokens, message_tokens, tool_result_tokens,
           overhead_tokens, input_total_tokens,
           input_budget_tokens, output_budget_tokens, reserved_tokens, compaction_trigger_tokens,
           compaction_id, compaction_applied, compaction_trigger_reason,
           prompt_tokens, prompt_source, completion_tokens, completion_source,
           reported_prompt_tokens, reported_completion_tokens, usage_estimated,
           rate_currency, rate_input_per_million, rate_output_per_million, rate_updated_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          record.sessionId,
          record.runId,
          record.requestSeq,
          record.attempt,
          record.providerId,
          record.modelId,
          record.outcome,
          record.finishReason ?? null,
          record.errorCode ?? null,
          record.createdAt,
          record.createdAt,
          record.breakdown.instructionTokens,
          record.breakdown.compactionTokens,
          record.breakdown.toolDefinitionTokens,
          record.breakdown.messageTokens,
          record.breakdown.toolResultTokens,
          record.breakdown.overheadTokens,
          record.breakdown.totalTokens,
          record.budget.inputBudgetTokens,
          record.budget.outputBudgetTokens,
          record.budget.reservedTokens,
          record.budget.compactionTriggerTokens,
          record.compaction?.id ?? null,
          record.compaction?.applied ? 1 : 0,
          record.compaction?.triggerReason ?? null,
          record.promptTokens ?? null,
          record.promptSource ?? null,
          record.completionTokens ?? null,
          record.completionSource ?? null,
          record.reportedPromptTokens ?? null,
          record.reportedCompletionTokens ?? null,
          record.usageEstimated ? 1 : 0,
          record.rate?.currency ?? null,
          record.rate?.inputPerMillion ?? null,
          record.rate?.outputPerMillion ?? null,
          record.rate?.updatedAt ?? null,
        ],
      );
      return true;
    });
  }

  update(key: RequestTelemetryKey, patch: RequestTelemetryPatch): void {
    const assignments: string[] = [];
    const args: SqlValue[] = [];
    const set = (column: string, value: SqlValue): void => {
      assignments.push(`${column} = ?`);
      args.push(value);
    };
    if (patch.outcome !== undefined) set("outcome", patch.outcome);
    if (patch.finishReason !== undefined) set("finish_reason", patch.finishReason);
    if (patch.errorCode !== undefined) set("error_code", patch.errorCode);
    if (patch.promptTokens !== undefined) set("prompt_tokens", patch.promptTokens);
    if (patch.promptSource !== undefined) set("prompt_source", patch.promptSource);
    if (patch.completionTokens !== undefined) set("completion_tokens", patch.completionTokens);
    if (patch.completionSource !== undefined) set("completion_source", patch.completionSource);
    if (patch.reportedPromptTokens !== undefined) set("reported_prompt_tokens", patch.reportedPromptTokens);
    if (patch.reportedCompletionTokens !== undefined) set("reported_completion_tokens", patch.reportedCompletionTokens);
    if (patch.usageEstimated !== undefined) set("usage_estimated", patch.usageEstimated ? 1 : 0);
    if (!assignments.length) return;
    set("updated_at", new Date().toISOString());
    args.push(key.sessionId, key.runId, key.requestSeq);
    this.driver.exec(
      `UPDATE assistant_requests SET ${assignments.join(", ")} WHERE session_id = ? AND run_id = ? AND request_seq = ?`,
      args,
    );
  }

  listBySession(sessionId: string, limit: number, offset: number): AssistantRequestRecord[] {
    const rows = this.driver.rows(
      `SELECT * FROM assistant_requests WHERE session_id = ?
       ORDER BY created_at DESC, request_seq DESC LIMIT ? OFFSET ?`,
      [sessionId, Math.max(1, Math.floor(limit)), Math.max(0, Math.floor(offset))],
    ) as unknown as RequestRow[];
    return rows.map(toRecord);
  }

  countBySession(sessionId: string): number {
    const row = this.driver.rows("SELECT COUNT(*) AS n FROM assistant_requests WHERE session_id = ?", [sessionId])[0];
    return num(row?.n);
  }

  summarize(sessionId: string): SessionUsageSummary {
    const row = this.driver.rows(
      `SELECT
         COUNT(*) AS n,
         COALESCE(SUM(CASE WHEN outcome = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
         COALESCE(SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN outcome = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
         COALESCE(SUM(CASE WHEN outcome = 'not_sent' THEN 1 ELSE 0 END), 0) AS not_sent,
         COALESCE(SUM(CASE WHEN outcome = 'sent' THEN 1 ELSE 0 END), 0) AS unconfirmed,
         COALESCE(SUM(CASE WHEN prompt_tokens IS NULL THEN 1 ELSE 0 END), 0) AS prompt_missing,
         COALESCE(SUM(prompt_tokens), 0) AS prompt_total,
         COALESCE(SUM(CASE WHEN completion_tokens IS NULL THEN 1 ELSE 0 END), 0) AS completion_missing,
         COALESCE(SUM(completion_tokens), 0) AS completion_total,
         COALESCE(SUM(CASE WHEN prompt_source = 'estimated' THEN 1 ELSE 0 END), 0) AS prompt_estimated,
         COALESCE(SUM(CASE WHEN completion_source = 'estimated' THEN 1 ELSE 0 END), 0) AS completion_estimated,
         COALESCE(SUM(CASE WHEN outcome <> 'not_sent' THEN instruction_tokens ELSE 0 END), 0) AS instruction_tokens,
         COALESCE(SUM(CASE WHEN outcome <> 'not_sent' THEN compaction_tokens ELSE 0 END), 0) AS compaction_tokens,
         COALESCE(SUM(CASE WHEN outcome <> 'not_sent' THEN tool_definition_tokens ELSE 0 END), 0) AS tool_definition_tokens,
         COALESCE(SUM(CASE WHEN outcome <> 'not_sent' THEN message_tokens ELSE 0 END), 0) AS message_tokens,
         COALESCE(SUM(CASE WHEN outcome <> 'not_sent' THEN tool_result_tokens ELSE 0 END), 0) AS tool_result_tokens,
         COALESCE(SUM(CASE WHEN outcome <> 'not_sent' THEN overhead_tokens ELSE 0 END), 0) AS overhead_tokens,
         COALESCE(SUM(CASE WHEN outcome <> 'not_sent' THEN input_total_tokens ELSE 0 END), 0) AS input_total_tokens
       FROM assistant_requests WHERE session_id = ?`,
      [sessionId],
    )[0] as unknown as Record<string, unknown> | undefined;
    const value = (key: string): number => num(row?.[key]);
    return {
      requests: value("n"),
      delivered: value("delivered"),
      failed: value("failed"),
      cancelled: value("cancelled"),
      notSent: value("not_sent"),
      unconfirmed: value("unconfirmed"),
      promptTokens: value("prompt_total"),
      completionTokens: value("completion_total"),
      promptMissing: value("prompt_missing"),
      completionMissing: value("completion_missing"),
      promptEstimated: value("prompt_estimated"),
      completionEstimated: value("completion_estimated"),
      breakdown: {
        instructionTokens: value("instruction_tokens"),
        compactionTokens: value("compaction_tokens"),
        toolDefinitionTokens: value("tool_definition_tokens"),
        messageTokens: value("message_tokens"),
        toolResultTokens: value("tool_result_tokens"),
        overheadTokens: value("overhead_tokens"),
        totalTokens: value("input_total_tokens"),
      },
    };
  }

  costGroups(sessionId: string): CurrencyCostGroup[] {
    const rows = this.driver.rows(
      `SELECT rate_currency AS currency,
         COUNT(*) AS n,
         COALESCE(SUM(CASE WHEN prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL AND rate_currency IS NOT NULL THEN 1 ELSE 0 END), 0) AS priced,
         COALESCE(SUM(CASE WHEN prompt_tokens IS NULL OR completion_tokens IS NULL THEN 1 ELSE 0 END), 0) AS missing,
         COALESCE(SUM(CASE WHEN prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL AND rate_currency IS NOT NULL
           THEN prompt_tokens * rate_input_per_million ELSE 0 END), 0) AS input_weighted,
         COALESCE(SUM(CASE WHEN prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL AND rate_currency IS NOT NULL
           THEN completion_tokens * rate_output_per_million ELSE 0 END), 0) AS output_weighted
       FROM assistant_requests WHERE session_id = ? AND outcome <> 'not_sent'
       GROUP BY rate_currency`,
      [sessionId],
    ) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      currency: typeof row.currency === "string" && row.currency ? row.currency : null,
      requests: num(row.n),
      pricedRequests: num(row.priced),
      missingUsageRequests: num(row.missing),
      inputWeighted: num(row.input_weighted),
      outputWeighted: num(row.output_weighted),
    }));
  }

  listSince(sessionId: string, sinceIso: string, limit: number): AssistantRequestRecord[] {
    const rows = this.driver.rows(
      `SELECT * FROM assistant_requests WHERE session_id = ? AND created_at >= ?
       ORDER BY created_at DESC, request_seq DESC LIMIT ?`,
      [sessionId, sinceIso, Math.max(1, Math.floor(limit))],
    ) as unknown as RequestRow[];
    return rows.map(toRecord);
  }

  purgeSession(sessionId: string): void {
    this.driver.exec("DELETE FROM assistant_requests WHERE session_id = ?", [sessionId]);
  }
}
