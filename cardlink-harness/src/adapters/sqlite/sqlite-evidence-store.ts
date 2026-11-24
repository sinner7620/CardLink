import type { EvidenceRow, EvidenceStore } from "../../application/ports/evidence-store.ts";
import type { SqlDriver } from "./db.ts";

export class SqliteEvidenceStore implements EvidenceStore {
  constructor(private readonly driver: SqlDriver) {}

  save(row: EvidenceRow): void {
    this.driver.exec(
      "INSERT OR IGNORE INTO evidence(evidence_id, run_id, snapshot_id, source_type, source_ref, result_hash, generated_at) VALUES(?,?,?,?,?,?,?)",
      [row.evidenceId, row.runId, row.snapshotId, row.sourceType, row.sourceRef, row.resultHash, row.generatedAt],
    );
  }

  get(evidenceId: string): EvidenceRow | null {
    const row = this.driver.rows(
      "SELECT evidence_id, run_id, snapshot_id, source_type, source_ref, result_hash, generated_at FROM evidence WHERE evidence_id = ?",
      [evidenceId],
    )[0] as
      | { evidence_id: string; run_id: string; snapshot_id: string; source_type: string; source_ref: string; result_hash: string; generated_at: string }
      | undefined;
    if (!row) return null;
    return {
      evidenceId: row.evidence_id,
      runId: row.run_id,
      snapshotId: row.snapshot_id,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      resultHash: row.result_hash,
      generatedAt: row.generated_at,
    };
  }
}
