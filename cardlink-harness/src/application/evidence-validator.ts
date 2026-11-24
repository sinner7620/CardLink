import { extractRecordIdCandidates } from "../domain/mistake.ts";
import type { EvidenceWarningCode, TurnEvidence } from "../domain/evidence.ts";
import type { MistakeRepository } from "./ports/mistake-repository.ts";
import type { SessionScope } from "../domain/session.ts";

export type EvidenceCheck = {
  /** 可验证的本轮引用（读取过且存在的 recordId）。 */
  evidenceRefs: string[];
  warnings: Array<{ code: EvidenceWarningCode; detail: string }>;
};

/**
 * §12/T15：轻量证据校验——引用 ID 必须存在且属于本轮读取；
 * 不通过时输出警告，不静默通过；自然语言推理的真实性不在此保证。
 */
export class EvidenceValidator {
  constructor(private readonly repository: MistakeRepository) {}

  async validateFinalMessage(text: string, evidence: TurnEvidence, scope: SessionScope): Promise<EvidenceCheck> {
    const warnings: Array<{ code: EvidenceWarningCode; detail: string }> = [];
    const verified = new Set<string>();
    const readSet = new Set(evidence.recordIds);
    // 引用存在性按本轮锁定快照核对（§6.2 不跨快照混算）。
    const repo = this.repository.forSnapshot ? this.repository.forSnapshot(evidence.snapshotId) : this.repository;
    const withoutCardScheme = text.replace(/(\]\(<?)card:/g, "$1");
    for (const candidate of extractRecordIdCandidates(withoutCardScheme)) {
      if (readSet.has(candidate)) {
        verified.add(candidate);
        continue;
      }
      const exists = await repo.getById(candidate, scope);
      if (exists) {
        warnings.push({ code: "record_not_read_this_turn", detail: `引用了存在但本轮未读取的错题: ${candidate}` });
      } else {
        warnings.push({ code: "unknown_record_reference", detail: `引用了不存在的错题 ID: ${candidate}` });
      }
    }
    return { evidenceRefs: [...verified], warnings };
  }
}
