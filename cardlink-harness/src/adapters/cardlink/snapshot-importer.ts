import type { ISODateTime } from "../../domain/message.ts";
import type {
  MistakeLevelInput,
  SnapshotBatch,
  SnapshotRecord,
} from "../../application/ports/mistake-repository.ts";
import { canonicalJson, sha256Hex } from "../sqlite/db.ts";

/**
 * 快照导出契约（§6.3，冻结的导入侧契约）：
 * { schemaVersion, sourceId, exportedAt, isFullSnapshot, records }
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

export type SnapshotExportPayload = {
  schemaVersion: number;
  sourceId: string;
  exportedAt: ISODateTime;
  isFullSnapshot: boolean;
  baseRevision?: string;
  records: SnapshotExportRecord[];
};

/** 导出侧单条记录：全字段 + 可选 OCR 文本（manualText 优先）。 */
export type SnapshotExportRecord = {
  recordId: string;
  sourceNotebookId: string;
  sourceNoteId: string;
  sourceAvailable?: boolean;
  sourceTitle: string;
  sourceNotebookTitle: string;
  sourceRootTitle?: string;
  sourcePathTitles?: string[];
  categoryPath?: string[];
  manualCategory?: string;
  manualCategories?: string[];
  customTags?: string[];
  reasonTags?: string[];
  favorite?: boolean;
  level?: number | "unknown";
  reviewCount?: number;
  reviewCompleted?: boolean;
  nextReviewAt?: string;
  lastReviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  answerNotebookId?: string;
  answerRootNodeId?: string;
  /** v2.16 §6.1：设备答案正文投影（加法字段；旧载荷可省略）。 */
  answerTextOrigin?: "import" | "answer_card";
  answerSourceNotebookId?: string;
  answerSourceNoteId?: string;
  answerStatus?: "projected" | "unavailable" | "missing";
  answerReason?: string;
  errorReasons?: { key: string; label: string }[];
  history?: Array<{ at: string; level: number | "unknown"; errorReason?: { key: string; label: string } }>;
  ocr?: {
    manualText?: string | null;
    effectiveText?: string;
    sourceFingerprint?: string;
  };
  questionText?: string;
  answerText?: string;
};

/** 插件错题库备份形态（{version:2, records}），与导出契约同时受支持（§6.3）。 */
export type PluginBackupPayload = {
  version: number;
  records: Record<string, unknown>;
};

export type ImportDiagnostics = {
  recordId?: string;
  field?: string;
  message: string;
};

export type ParsedSnapshot = {
  batch: SnapshotBatch;
  warnings: string[];
  sourceKind: "harness-contract" | "plugin-backup";
  /** 原始记录无损保留（v2.1 §6.1 sourcePayload）。 */
  rawByRecordId: Map<string, Record<string, unknown>>;
};

export class SnapshotImportError extends Error {
  constructor(public readonly diagnostics: ImportDiagnostics[]) {
    super(`快照校验失败，整批回滚（${diagnostics.length} 条诊断）`);
    this.name = "SnapshotImportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asOptionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normalizeLevel(v: unknown): MistakeLevelInput {
  if (v === 0 || v === 1 || v === 2) return v;
  return "unknown";
}

function normalizeErrorReason(v: unknown): { key: string; label: string } | undefined {
  if (!isRecord(v)) return undefined;
  if (typeof v.key !== "string" || !v.key) return undefined;
  return { key: v.key, label: asString(v.label, v.key) };
}

function validIso(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  if (Number.isNaN(Date.parse(v))) return undefined;
  // 归一化为 UTC ISO 字符串：投影内所有时间比较（如到期判断）都是 UTC 字符串比较，
  // 混合偏移量的字符串比较会得到错误结果。
  return new Date(v).toISOString();
}

/** 选定题干正文：ocr.manualText（用户修订）> ocr.effectiveText > questionText。 */
function pickQuestionText(rec: Record<string, unknown>): string | undefined {
  const ocr = isRecord(rec.ocr) ? rec.ocr : undefined;
  const manual = typeof ocr?.manualText === "string" && ocr.manualText.trim() ? ocr.manualText : undefined;
  if (manual) return manual;
  const effective = typeof ocr?.effectiveText === "string" && ocr.effectiveText.trim() ? ocr.effectiveText : undefined;
  if (effective) return effective;
  return asOptionalString(rec.questionText);
}

function normalizeRecord(rec: Record<string, unknown>, index: number, warnings: string[], pluginRecord: boolean): SnapshotRecord {
  const recordId = asString(rec.recordId ?? rec["recordId"]);
  const sourceNotebookId = asString(rec.sourceNotebookId);
  const sourceNoteId = asString(rec.sourceNoteId);
  if (!recordId || !sourceNotebookId || !sourceNoteId) {
    throw new ImportDiagnosticsError(index, recordId || undefined, "recordId", "recordId/sourceNotebookId/sourceNoteId 缺失");
  }
  if (recordId !== `${sourceNotebookId}:${sourceNoteId}`) {
    warnings.push(`记录 ${recordId} 与 sourceRecordKey 拼接不一致（按提供值导入）`);
  }
  const history = Array.isArray(rec.history) ? rec.history : [];
  const reviewEvents = history
    .map((h) => {
      if (!isRecord(h)) return null;
      const at = validIso(h.at);
      if (!at) {
        warnings.push(`记录 ${recordId} 存在时间非法的 history 条目，已跳过`);
        return null;
      }
      return {
        at,
        level: normalizeLevel(h.level),
        errorReason: normalizeErrorReason(h.errorReason),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const manualCategories = asStringArray(rec.manualCategories);
  const legacyManualCategory = asOptionalString(rec.manualCategory)?.trim();
  const usesLegacyTags = pluginRecord && !Object.prototype.hasOwnProperty.call(rec, "customTags");
  if (legacyManualCategory && !manualCategories.includes(legacyManualCategory) && (!usesLegacyTags || !manualCategories.length)) {
    manualCategories.unshift(legacyManualCategory);
  }
  const errorReasons = Array.isArray(rec.errorReasons)
    ? (rec.errorReasons.map(normalizeErrorReason).filter((x): x is { key: string; label: string } => x !== undefined))
    : [];

  const questionText = pickQuestionText(rec);
  const answerText = asOptionalString(rec.answerText);
  if (questionText && questionText.length > 200000) {
    throw new ImportDiagnosticsError(index, recordId, "questionText", "题干正文超过 200000 字符上限");
  }
  if (answerText && answerText.length > 200000) {
    throw new ImportDiagnosticsError(index, recordId, "answerText", "答案正文超过 200000 字符上限");
  }
  const answerTextOrigin = rec.answerTextOrigin === "answer_card" || rec.answerTextOrigin === "import"
    ? rec.answerTextOrigin
    : undefined;
  const answerStatus = rec.answerStatus === "projected" || rec.answerStatus === "unavailable" || rec.answerStatus === "missing"
    ? rec.answerStatus
    : undefined;
  const ANSWER_REASONS = new Set([
    "answer_source_unbound", "answer_not_found", "answer_index_unavailable", "answer_ambiguous",
    "answer_note_unavailable", "answer_text_empty", "source_note_unavailable",
  ]);
  const answerReason = asOptionalString(rec.answerReason);
  if (answerReason && !ANSWER_REASONS.has(answerReason)) {
    throw new ImportDiagnosticsError(index, recordId, "answerReason", "answerReason 不在允许的枚举内");
  }

  return {
    recordId,
    sourceNotebookId,
    sourceNoteId,
    sourceAvailable: asBool(rec.sourceAvailable, true),
    sourceTitle: asString(rec.sourceTitle, "(无标题)"),
    sourceNotebookTitle: asString(rec.sourceNotebookTitle, "(未知笔记本)"),
    sourceRootTitle: asOptionalString(rec.sourceRootTitle),
    sourcePathTitles: asStringArray(rec.sourcePathTitles),
    categoryPath: asStringArray(rec.categoryPath),
    manualCategories: usesLegacyTags ? [] : manualCategories,
    customTags: usesLegacyTags ? manualCategories : asStringArray(rec.customTags),
    reasonTags: asStringArray(rec.reasonTags),
    favorite: asBool(rec.favorite),
    errorReasons,
    questionText,
    answerText,
    level: normalizeLevel(rec.level),
    reviewCount: asNumber(rec.reviewCount),
    reviewCompleted: asBool(rec.reviewCompleted),
    nextReviewAt: validIso(rec.nextReviewAt),
    lastReviewedAt: validIso(rec.lastReviewedAt),
    createdAt: validIso(rec.createdAt),
    updatedAt: validIso(rec.updatedAt),
    answerNotebookId: asOptionalString(rec.answerNotebookId),
    answerRootNodeId: asOptionalString(rec.answerRootNodeId),
    answerTextOrigin,
    answerSourceNotebookId: asOptionalString(rec.answerSourceNotebookId),
    answerSourceNoteId: asOptionalString(rec.answerSourceNoteId),
    answerStatus,
    answerReason,
    reviewEvents,
  };
}

class ImportDiagnosticsError extends Error {
  constructor(
    public readonly index: number,
    public readonly recordId: string | undefined,
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

function tryNormalizeRecord(rec: Record<string, unknown>, index: number, warnings: string[], pluginRecord: boolean, fallbackId?: string): SnapshotRecord {
  try {
    return normalizeRecord(rec, index, warnings, pluginRecord);
  } catch (error) {
    if (error instanceof ImportDiagnosticsError) {
      throw new SnapshotImportError([
        { recordId: error.recordId ?? fallbackId, field: error.field, message: error.message },
      ]);
    }
    throw error;
  }
}

/** 校验 + 规范化两种载荷形态；任何一条记录非法 → 整批失败并给出字段级诊断（§6.3）。 */
export function parseSnapshotPayload(payload: unknown): ParsedSnapshot {
  if (!isRecord(payload)) {
    throw new SnapshotImportError([{ message: "载荷必须是 JSON 对象" }]);
  }
  const warnings: string[] = [];

  if (payload.version === 2 && isRecord(payload.records)) {
    // 插件错题库备份形态。
    const entries = Object.entries(payload.records);
    const records: SnapshotRecord[] = [];
    const rawByRecordId = new Map<string, Record<string, unknown>>();
    for (const [key, rec] of entries) {
      if (!isRecord(rec)) {
        throw new SnapshotImportError([{ recordId: key, message: "records 值必须是对象" }]);
      }
      const merged = { ...rec, recordId: asString(rec.recordId, key) };
      records.push(tryNormalizeRecord(merged, 0, warnings, true, key));
      rawByRecordId.set(records[records.length - 1]!.recordId, rec);
    }
    if (!records.length) {
      throw new SnapshotImportError([{ message: "备份 records 为空" }]);
    }
    const exportedAt = new Date().toISOString();
    return {
      batch: {
        snapshotId: sha256Hex(canonicalJson({ sourceId: "cardlink-backup", exportedAt, records })),
        sourceId: "cardlink-backup",
        exportedAt,
        isFullSnapshot: true,
        records,
      },
      warnings,
      sourceKind: "plugin-backup",
      rawByRecordId,
    };
  }

  // Harness 导出契约形态。
  const schemaVersion = payload.schemaVersion;
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotImportError([
      { field: "schemaVersion", message: `schemaVersion 必须是 ${SNAPSHOT_SCHEMA_VERSION}，收到 ${JSON.stringify(schemaVersion)}` },
    ]);
  }
  const sourceId = asString(payload.sourceId);
  if (!sourceId) throw new SnapshotImportError([{ field: "sourceId", message: "sourceId 缺失" }]);
  const exportedAt = validIso(payload.exportedAt);
  if (!exportedAt) throw new SnapshotImportError([{ field: "exportedAt", message: "exportedAt 缺失或时间非法" }]);
  const isFullSnapshot = asBool(payload.isFullSnapshot, false);
  const baseRevision = asOptionalString(payload.baseRevision)?.trim();
  if (payload.baseRevision !== undefined && (!baseRevision || isFullSnapshot)) {
    throw new SnapshotImportError([{ field: "baseRevision", message: "baseRevision 仅适用于增量快照且必须是非空字符串" }]);
  }
  if (!Array.isArray(payload.records)) {
    throw new SnapshotImportError([{ field: "records", message: "records 必须是数组" }]);
  }
  const records: SnapshotRecord[] = [];
  const rawByRecordId = new Map<string, Record<string, unknown>>();
  payload.records.forEach((rec, index) => {
    if (!isRecord(rec)) {
      throw new SnapshotImportError([{ field: "records", message: `records[${index}] 必须是对象` }]);
    }
    records.push(tryNormalizeRecord(rec, index, warnings, sourceId === "cardlink-plugin"));
    rawByRecordId.set(records[records.length - 1].recordId, rec);
  });
  if (!records.length) {
    throw new SnapshotImportError([{ field: "records", message: "records 为空（如需表达空库请使用全量空备份文件）" }]);
  }
  const snapshotId = sha256Hex(canonicalJson({ sourceId, exportedAt, isFullSnapshot, baseRevision, records }));
  return {
    batch: { snapshotId, sourceId, exportedAt, isFullSnapshot, baseRevision, records },
    warnings,
    sourceKind: "harness-contract",
    rawByRecordId,
  };
}
