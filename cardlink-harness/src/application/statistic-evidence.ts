import type { StatisticEvidence } from "../domain/evidence.ts";

const summaryFields: Record<string, string> = {
  totalRecords: "错题总数",
  totalMistakes: "错题总数",
  availableRecords: "来源可用题数",
  dueCount: "到期题数",
  reviewedRecordCount: "已复习题数",
  reviewedCount: "已复习题数",
  totalReviewActions: "累计复习次数",
  reviewEventCount: "累计复习次数",
  currentLevelReviewCountSum: "当前等级复习计数合计",
  matchingRecords: "匹配题数",
  recordsWithErrorReasons: "有错因记录的题数",
  verifiedReviewCount: "可核实复习次数",
  // v2.18 §9.4：跨题错因复习历史报表。
  totalMatchedRecords: "达到门槛的题数",
  recordsWithQualifyingEvents: "有带错因复习记录的题数",
  totalQualifyingEvents: "带错因复习记录总数",
  reviewedRecordsInWindow: "窗口内有复习记录的题数",
  "levelCounts.0": "不会题数",
  "levelCounts.1": "不熟题数",
  "levelCounts.2": "掌握题数",
  "levelCounts.unknown": "等级未知题数",
};

const coverageFields: Record<string, string> = {
  "reviewCoverage.matchingRecords": "匹配题数",
  "reviewCoverage.recordsWithHistory": "有历史记录的题数",
};

export function supportsStatisticEvidence(toolName: string): boolean {
  return toolName === "getMistakeStats" || toolName === "queryMistakes" ||
    toolName === "getReviewHistory" || toolName === "listWeakPoints";
}

function ownField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null || !Object.prototype.hasOwnProperty.call(value, field)) return undefined;
  return (value as Record<string, unknown>)[field];
}

export function statisticValue(evidence: StatisticEvidence, path: string): { value: number; label: string } | null {
  path = path.replace(/^data\./, "").replace(/\[(\d+)\]/g, ".$1");
  let label: unknown;
  switch (evidence.toolName) {
    case "getMistakeStats":
      label = ownField(summaryFields, path) ?? ownField(coverageFields, path);
      if (/^reasons\.\d+\.recordCount$/.test(path)) label = "该错因的题数";
      // v2.16 §9.3：覆盖率报表的可引用数值（只从本轮同快照结果取值）。
      if (/^dimensions\.\d+\.(recordCount|totalGroups|omittedGroups)$/.test(path)) label = "该维度题数/分组数";
      if (/^dimensions\.\d+\.groups\.\d+\.recordCount$/.test(path)) label = "该分组题数";
      if (/^dimensions\.\d+\.groups\.\d+\.coverage\.questionText\.available$/.test(path)) label = "有题干题数";
      if (/^dimensions\.\d+\.groups\.\d+\.coverage\.answerText\.available$/.test(path)) label = "可读取答案题数";
      if (/^dimensions\.\d+\.groups\.\d+\.coverage\.answerText\.(unlocatable|outOfScope)$/.test(path)) label = "答案不可读取题数";
      if (/^dimensions\.\d+\.groups\.\d+\.coverage\.reviewHistory\.available$/.test(path)) label = "有可核实复习历史的题数";
      // v2.18 §9.4：榜单逐题/逐错因计数（只从本轮同快照结果取值）。
      if (/^records\.\d+\.eventCount$/.test(path)) label = "该题带错因复习事件数";
      if (/^records\.\d+\.errorKeys\.\d+\.eventCount$/.test(path)) label = "该错因复习记录次数";
      break;
    case "queryMistakes":
      label = ownField(coverageFields, path);
      if (/^records\.\d+\.verifiedReviewCount$/.test(path)) label = "该题可核实复习次数";
      break;
    case "getReviewHistory":
      if (path === "total") label = "该题历史条目数（含入册）";
      break;
    case "listWeakPoints":
      if (/^distribution\.\d+\.count$/.test(path)) label = "该分类的题数";
      break;
  }
  if (typeof label !== "string") return null;
  const value = path.split(".").reduce(ownField, evidence.data);
  return typeof value === "number" && Number.isFinite(value) ? { value, label } : null;
}

export function statisticEvidenceInstruction(statistics: StatisticEvidence[]): string {
  if (!statistics.length) return "";
  return "本轮可用的统计证据（工具调用 ID → evidenceId）：\n" +
    statistics.map((item) => `${JSON.stringify(item.toolCallId)} → ${JSON.stringify(item.evidenceId)}`).join("\n");
}
