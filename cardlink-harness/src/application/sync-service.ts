import { parseSnapshotPayload, SnapshotImportError } from "../adapters/cardlink/snapshot-importer.ts";
import type { ParsedSnapshot } from "../adapters/cardlink/snapshot-importer.ts";
import type {
  SnapshotManifest,
  VersionedImportPayload,
  VersionedImportResult,
  VersionedMistakeRepository,
  VersionedSnapshotRecord,
} from "./ports/versioned-mistake-repository.ts";
import type { SnapshotRecord } from "./ports/mistake-repository.ts";

/** 同步结果：版本化导入计数（含旧端口兼容计数）+ 载荷形态来源（§13 importSnapshot 响应）。 */
export type SyncOutcome = VersionedImportResult & {
  sourceKind: ParsedSnapshot["sourceKind"];
  errors?: { recordId?: string; field?: string; message: string }[];
};

/**
 * 同步服务：导入 API 专用（§13），不暴露给模型工具调用。
 * 校验失败的批次整批回滚并输出字段级诊断（§6.3）。
 * 落点为版本化投影（§6.2）：sourcePayload 取解析器保留的原始记录字段（G7 无损）。
 */
export class SyncService {
  constructor(private readonly repository: VersionedMistakeRepository) {}

  async importSnapshot(payload: unknown, options: { preferIncremental?: boolean } = {}): Promise<SyncOutcome> {
    let parsed: ParsedSnapshot;
    try {
      parsed = parseSnapshotPayload(payload);
    } catch (error) {
      if (error instanceof SnapshotImportError) {
        const err = new Error(`快照校验失败：${error.diagnostics.map((d: ImportDiagnosticsEntry) => d.message).join("; ")}`);
        (err as SyncImportFailure).diagnostics = error.diagnostics;
        throw err;
      }
      throw error;
    }
    const versioned = await this.toVersionedPayload(parsed);
    if (versioned.manifest.complete && options.preferIncremental !== undefined) {
      versioned.preferIncremental = options.preferIncremental;
    }
    const result = await this.repository.applySnapshot(versioned);
    return { ...result, sourceKind: parsed.sourceKind };
  }

  async getSnapshotMeta(): Promise<SnapshotManifest | null> {
    return this.repository.getSnapshot((await this.repository.latestSnapshotId()) ?? "");
  }

  /** 契约/备份载荷 → 版本化导入载荷；raw 字段进 sourcePayload，history 归一。 */
  private async toVersionedPayload(parsed: ParsedSnapshot): Promise<VersionedImportPayload> {
    const batch = parsed.batch;
    const records: VersionedSnapshotRecord[] = batch.records.map((rec: SnapshotRecord) => {
      const raw = parsed.rawByRecordId?.get(rec.recordId);
      const history = rec.reviewEvents.map((e) => ({
        at: e.at,
        level: e.level === "unknown" ? null : e.level,
        errorReason: e.errorReason,
      }));
      const level = rec.level === undefined || rec.level === "unknown" ? null : rec.level;
      return {
        recordId: rec.recordId,
        sourceNotebookId: rec.sourceNotebookId,
        sourceNoteId: rec.sourceNoteId,
        sourceAvailable: rec.sourceAvailable,
        level,
        currentLevelReviewCount: rec.reviewCount,
        reviewCompleted: rec.reviewCompleted,
        nextReviewAt: rec.nextReviewAt,
        lastReviewedAt: rec.lastReviewedAt,
        favorite: rec.favorite,
        categoryPath: rec.categoryPath,
        manualCategories: rec.manualCategories,
        customTags: rec.customTags ?? [],
        reasonTags: rec.reasonTags,
        errorReasons: rec.errorReasons,
        sourceTitle: rec.sourceTitle,
        sourceNotebookTitle: rec.sourceNotebookTitle,
        sourceRootTitle: rec.sourceRootTitle,
        sourcePathTitles: rec.sourcePathTitles,
        questionText: rec.questionText,
        answerText: rec.answerText,
        ocr: parseOcr(raw, rec.questionText, rec.answerText),
        sourcePayload: raw ?? { ...rec, history },
        history,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        answerNotebookId: rec.answerNotebookId,
        answerRootNodeId: rec.answerRootNodeId,
        answerTextOrigin: rec.answerTextOrigin,
        answerSourceNotebookId: rec.answerSourceNotebookId,
        answerSourceNoteId: rec.answerSourceNoteId,
        answerStatus: rec.answerStatus,
        answerReason: rec.answerReason,
        contentHash: "",
      };
    });
    const baseRevision = batch.isFullSnapshot ? undefined : batch.baseRevision ?? await this.repository.latestSnapshotId();
    return {
      manifest: {
        sourceId: batch.sourceId,
        sourceRevision: batch.exportedAt,
        importedAt: new Date().toISOString(),
        scope: { notebookIds: [] },
        // 增量必须挂当前最新基线（§6.2）；空库上的增量等价完整快照。
        complete: batch.isFullSnapshot || !baseRevision,
        ...(baseRevision ? { baseRevision } : {}),
      },
      records,
    };
  }
}

/** 原始载荷带 OCR 时保留用户修订（G7）；否则按题干/答案派生状态。 */
function parseOcr(
  raw: Record<string, unknown> | undefined,
  questionText?: string,
  answerText?: string,
): VersionedSnapshotRecord["ocr"] {
  const ocr = raw && typeof raw.ocr === "object" && raw.ocr !== null ? (raw.ocr as Record<string, unknown>) : undefined;
  const rawText = typeof ocr?.rawText === "string" ? ocr.rawText : undefined;
  const manualText = typeof ocr?.manualText === "string" && ocr.manualText.trim() ? ocr.manualText : undefined;
  const effectiveText = typeof ocr?.effectiveText === "string" && ocr.effectiveText.trim() ? ocr.effectiveText : undefined;
  const origin = ocr ? (typeof ocr.origin === "string" ? ocr.origin : "ocr") : "none";
  const status: VersionedSnapshotRecord["ocr"]["status"] =
    manualText || effectiveText || (questionText && questionText.trim())
      ? "complete"
      : answerText && answerText.trim()
        ? "partial"
        : "missing";
  return {
    rawText,
    manualText,
    effectiveText,
    origin: (["manual", "ocr", "note", "none"] as const).includes(origin as "manual" | "ocr" | "note" | "none")
      ? (origin as "manual" | "ocr" | "note" | "none")
      : "ocr",
    status,
  };
}

export type SyncImportFailure = Error & { diagnostics: { recordId?: string; field?: string; message: string }[] };

type ImportDiagnosticsEntry = { recordId?: string; field?: string; message: string };

export function isSyncImportFailure(error: unknown): error is SyncImportFailure {
  return error instanceof Error && Array.isArray((error as SyncImportFailure).diagnostics);
}

export { SnapshotImportError };
