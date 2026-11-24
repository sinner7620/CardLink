import type { CompactionRecord, CompactionStore, SavedCompaction } from "../../application/ports/compaction-store.ts";
import type { SqlDriver } from "./db.ts";

interface CompactionRow {
  id: string;
  session_id: string;
  first_kept_message_id: string;
  summary: string;
  snapshot_id: string | null;
  tokens_before: number | null;
  tokens_after: number | null;
  model_id: string | null;
  last_compressed_sequence_no: number | null;
  summary_hash: string | null;
  trigger_reason: CompactionRecord["triggerReason"] | null;
  created_at: string;
}

function toRecord(row: CompactionRow): CompactionRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    firstKeptMessageId: row.first_kept_message_id,
    summary: row.summary,
    snapshotId: row.snapshot_id ?? undefined,
    tokensBefore: row.tokens_before == null ? undefined : Number(row.tokens_before),
    tokensAfter: row.tokens_after == null ? undefined : Number(row.tokens_after),
    modelId: row.model_id ?? undefined,
    lastCompressedSequenceNo: row.last_compressed_sequence_no == null ? undefined : Number(row.last_compressed_sequence_no),
    summaryHash: row.summary_hash ?? undefined,
    triggerReason: row.trigger_reason ?? undefined,
    createdAt: row.created_at,
  };
}

/** v2.5 §11.1：压缩记录持久化（原文不动；仅记录发送给模型的摘要视图）。 */
export class SqliteCompactionStore implements CompactionStore {
  constructor(private readonly driver: SqlDriver) {}

  save(record: CompactionRecord, coveredMessageCount?: number): SavedCompaction {
    return this.driver.transaction(() => {
      const duplicate = this.driver.rows(
        `SELECT * FROM session_compactions
         WHERE session_id = ? AND first_kept_message_id = ? AND summary = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        [record.sessionId, record.firstKeptMessageId, record.summary],
      )[0] as unknown as CompactionRow | undefined;
      if (duplicate) return { record: toRecord(duplicate), inserted: false };

      const event = coveredMessageCount
        ? this.driver.rows(
            "SELECT sequence_no FROM session_events WHERE session_id = ? ORDER BY sequence_no LIMIT 1 OFFSET ?",
            [record.sessionId, coveredMessageCount - 1],
          )[0]
        : undefined;
      const lastCompressedSequenceNo = event ? Number(event.sequence_no) : undefined;
      this.driver.exec(
        `INSERT INTO session_compactions(
           id, session_id, first_kept_message_id, summary, snapshot_id, tokens_before, tokens_after, model_id,
           last_compressed_sequence_no, summary_hash, trigger_reason, created_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          record.id,
          record.sessionId,
          record.firstKeptMessageId,
          record.summary,
          record.snapshotId ?? null,
          record.tokensBefore ?? null,
          record.tokensAfter ?? null,
          record.modelId ?? null,
          lastCompressedSequenceNo ?? null,
          record.summaryHash ?? null,
          record.triggerReason ?? null,
          record.createdAt,
        ],
      );
      return { record: { ...record, lastCompressedSequenceNo }, inserted: true };
    });
  }

  latest(sessionId: string): CompactionRecord | null {
    const row = this.driver.rows(
      "SELECT * FROM session_compactions WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      [sessionId],
    )[0] as unknown as CompactionRow | undefined;
    return row ? toRecord(row) : null;
  }

  list(sessionId: string): CompactionRecord[] {
    const rows = this.driver.rows(
      "SELECT * FROM session_compactions WHERE session_id = ? ORDER BY created_at ASC, rowid ASC",
      [sessionId],
    ) as unknown as CompactionRow[];
    return rows.map(toRecord);
  }

  count(sessionId: string): number {
    const row = this.driver.rows("SELECT COUNT(*) AS n FROM session_compactions WHERE session_id = ?", [sessionId])[0] as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  }
}
