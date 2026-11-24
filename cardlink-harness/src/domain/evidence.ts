import type { ISODateTime } from "./message.ts";

/** §9 只读工具统一返回包络（冻结契约）。 */
export type ToolEnvelope<T = unknown> = {
  ok: boolean;
  tool: string;
  data?: T;
  error?: { code: string; message: string };
  evidence: { recordIds?: string[]; snapshotId: string; dataAsOf: ISODateTime };
  truncated?: boolean;
};

export type ToolErrorCode =
  | "no_snapshot"
  | "not_found"
  | "text_unavailable"
  | "insufficient_labels"
  | "invalid_args"
  | "internal_error";

export function okEnvelope<T>(
  tool: string,
  data: T,
  evidence: { recordIds?: string[]; snapshotId: string; dataAsOf: ISODateTime },
  truncated = false,
): ToolEnvelope<T> {
  return { ok: true, tool, data, evidence, truncated: truncated || undefined };
}

export function errorEnvelope(
  tool: string,
  code: ToolErrorCode,
  message: string,
  snapshotId: string,
  dataAsOf: ISODateTime,
): ToolEnvelope<never> {
  return { ok: false, tool, error: { code, message }, evidence: { snapshotId, dataAsOf } };
}

export type EvidenceWarningCode = "unknown_record_reference" | "record_not_read_this_turn" | "unverified_statistic";

export type StatisticEvidence = {
  evidenceId: string;
  ref?: string;
  messageId?: string;
  toolCallId: string;
  toolName: string;
  data: unknown;
};

export type TurnEvidence = {
  snapshotId: string;
  dataAsOf: ISODateTime;
  /** 本轮工具结果中读取到的 recordId。 */
  recordIds: string[];
  /** Verified outcomes of successful tools in this run and snapshot. */
  statistics: StatisticEvidence[];
};

export const OCR_TEXT_MAX_LENGTH = 4000;
export const QUERY_LIMIT_MAX = 50;
export const REVIEW_HISTORY_LIMIT_MAX = 100;
export const STRING_ARG_MAX_LENGTH = 128;
export const NOTEBOOK_IDS_MAX = 64;
export const TIME_SPAN_MAX_DAYS = 366;
