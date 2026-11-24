/** 基线只读视图（§6.3）；避免 application 依赖具体 SQLite 适配器。 */
export type SourceBaselineView = {
  fingerprint: string;
  snapshotId: string;
  updatedAt: string;
};

/**
 * v2.16 §6.3：快照新鲜度判定（纯函数）。
 *
 * current 要求三条同时成立：有基线、当前投影指纹与基线一致、基线快照就是最新快照。
 * 只有基线快照 ID 相同而没有可比较的指纹时（例如桌面/HTTP 运行时无本地源）返回 unknown，
 * 不把"最新快照存在"当作"数据未变"。
 */
export type FreshnessStatus = "current" | "stale" | "unknown";

export type FreshnessJudgement = {
  status: FreshnessStatus;
  reason?: string;
};

export function judgeFreshness(input: {
  baseline: SourceBaselineView | null;
  currentFingerprint?: string;
  latestSnapshotId: string;
}): FreshnessJudgement {
  if (!input.currentFingerprint) {
    return { status: "unknown", reason: "source_fingerprint_unavailable: 当前运行时无法计算本地源指纹" };
  }
  if (!input.baseline) {
    return { status: "unknown", reason: "no_baseline: 尚未同步过，或旧版本未记录本地源基线" };
  }
  if (input.baseline.fingerprint !== input.currentFingerprint) {
    return { status: "stale", reason: "fingerprint_mismatch: 本地错题/OCR/答案绑定已变化" };
  }
  if (input.baseline.snapshotId !== input.latestSnapshotId) {
    return { status: "stale", reason: "snapshot_advanced: 最新快照不是基线记录的那一版" };
  }
  return { status: "current" };
}
