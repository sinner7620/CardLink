/**
 * P4-1：SnapshotBuilder 纯核心（GPT 顺序第 2 步）。
 * 把 CardLink 插件的错题记录（src/mistake-domain.ts MistakeRecord 形态）+ OCR 库
 * 行（ocr_questions）转换为 Harness 快照契约载荷（§6.3），供 SyncService 校验导入。
 * 只做数据整形，不做导入与校验决策——校验/回滚/诊断全部由 SyncService 承担。
 * G7：用户自定义内容（分类/标签/错因/收藏）与 OCR 手工修订逐字段保留；修订优先于机器文本。
 */

export type PluginOcrRow = {
  record_id: string;
  native_text?: string | null;
  ocr_text?: string | null;
  manual_text?: string | null;
  effective_text?: string | null;
  status?: string | null;
};

export type SnapshotBuilderOptions = {
  sourceId?: string;
  exportedAt?: string;
};

export type SnapshotPayload = {
  schemaVersion: 1;
  sourceId: string;
  exportedAt: string;
  isFullSnapshot: true;
  records: Array<Record<string, unknown>>;
};

function textOrNull(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/** OCR 行 → 契约 ocr 对象（G7：manualText 用户修订优先，origin 如实标注）。 */
export function ocrRowToContract(row: PluginOcrRow | undefined): Record<string, unknown> {
  if (!row) return { origin: "none", status: "missing" };
  const manualText = textOrNull(row.manual_text);
  const ocrText = textOrNull(row.ocr_text);
  const rawText = textOrNull(row.native_text);
  const effectiveText = textOrNull(row.effective_text);
  const origin: "manual" | "ocr" | "note" | "none" = manualText ? "manual" : ocrText ? "ocr" : rawText ? "note" : "none";
  const status: "complete" | "partial" | "missing" =
    effectiveText || manualText || ocrText || rawText ? "complete" : typeof row.status === "string" && row.status ? "missing" : "missing";
  return {
    rawText,
    manualText,
    effectiveText: effectiveText ?? ([rawText, ocrText].filter(Boolean).join("\n\n") || undefined),
    origin,
    status: status === "missing" && (effectiveText || manualText) ? "complete" : status,
  };
}

/**
 * 插件记录数组 + OCR 行 → 快照契约载荷（全量快照）。
 * 未知字段由 SyncService/导入器按 §6.3 诊断拒绝或规范化；本层不吞错。
 */
export function buildSnapshotPayload(
  records: Array<Record<string, unknown>>,
  ocrRows: PluginOcrRow[] = [],
  options: SnapshotBuilderOptions = {},
): SnapshotPayload {
  const ocrByRecordId = new Map<string, PluginOcrRow>();
  for (const row of ocrRows) {
    if (row && typeof row.record_id === "string") ocrByRecordId.set(row.record_id, row);
  }
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const out: Array<Record<string, unknown>> = records.map((rec) => {
    const recordId = String(rec.recordId ?? "");
    const ocr = ocrRowToContract(ocrByRecordId.get(recordId));
    return {
      recordId,
      sourceNotebookId: String(rec.sourceNotebookId ?? ""),
      sourceNoteId: String(rec.sourceNoteId ?? ""),
      sourceAvailable: rec.sourceAvailable !== false,
      sourceTitle: typeof rec.sourceTitle === "string" && rec.sourceTitle.trim() ? rec.sourceTitle : "(无标题)",
      sourceNotebookTitle: typeof rec.sourceNotebookTitle === "string" && rec.sourceNotebookTitle.trim() ? rec.sourceNotebookTitle : "(未知笔记本)",
      sourceRootTitle: textOrNull(rec.sourceRootTitle),
      sourcePathTitles: stringArray(rec.sourcePathTitles),
      categoryPath: stringArray(rec.categoryPath),
      reasonTags: stringArray(rec.reasonTags),
      errorReasons: Array.isArray(rec.errorReasons) ? rec.errorReasons : [],
      // 题干不在此处注入——导入器按 ocr.manualText > ocr.effectiveText > questionText 取用（G7 修订优先）。
      // 原始字段无损（G7）：history/levelModel/tagsWrittenAt 等插件自有字段随 ...rec 进 sourcePayload；
      // 展开后的显式键保证关键形态（ocr 注入、boolean 严格化）不被原始 undefined 覆盖。
      ...rec,
      favorite: rec.favorite === true,
      level: typeof rec.level === "number" && (rec.level === 0 || rec.level === 1 || rec.level === 2) ? rec.level : null,
      answerText: textOrNull(rec.answerText),
      answerNotebookId: textOrNull(rec.answerNotebookId),
      answerRootNodeId: textOrNull(rec.answerRootNodeId),
      // v2.16 §6.1：设备答案正文投影的加法字段（旧载荷没有这些键时保持原行为）。
      answerTextOrigin: rec.answerTextOrigin === "answer_card" || rec.answerTextOrigin === "import"
        ? rec.answerTextOrigin
        : undefined,
      answerSourceNotebookId: textOrNull(rec.answerSourceNotebookId),
      answerSourceNoteId: textOrNull(rec.answerSourceNoteId),
      answerStatus: rec.answerStatus === "projected" || rec.answerStatus === "unavailable" || rec.answerStatus === "missing"
        ? rec.answerStatus
        : undefined,
      answerReason: textOrNull(rec.answerReason),
      ocr,
    };
  });
  return {
    schemaVersion: 1,
    sourceId: options.sourceId ?? "cardlink-plugin",
    exportedAt,
    isFullSnapshot: true,
    records: out,
  };
}
