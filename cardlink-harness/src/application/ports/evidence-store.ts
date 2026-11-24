import { canonicalJson } from "../../domain/canonical.ts";
import { sha256Hex } from "../../platform/sha256.ts";

/**
 * v2.1 §7：证据表端口。每次执行成功的只读工具结果落一行，
 * harness.getEvidence 按 evidenceId 查询（G5：引用可回溯到本轮同快照证据）。
 */
export type EvidenceRow = {
  evidenceId: string;
  runId: string;
  snapshotId: string;
  /** 证据来源类型（当前固定 tool_result）。 */
  sourceType: string;
  /** 来源引用：toolCallId。 */
  sourceRef: string;
  /** 结果内容哈希（canonical JSON SHA-256），供统计结果一致性核验。 */
  resultHash: string;
  generatedAt: string;
};

export interface EvidenceStore {
  save(row: EvidenceRow): void;
  get(evidenceId: string): EvidenceRow | null;
}

/** 确定性 evidenceId：同 run + 同 toolCall + 同内容哈希幂等。 */
export function newEvidenceId(runId: string, toolCallId: string, resultHash: string): string {
  return `ev_${sha256Hex(canonicalJson([runId, toolCallId, resultHash]))}`;
}
