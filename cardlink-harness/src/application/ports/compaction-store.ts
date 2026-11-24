/**
 * v2.5 §11.1：持久化压缩记录端口。
 * 只保存"发给模型的上下文摘要"，原文仍完整保存在 session_events；
 * 软删除会话时记录保留，彻底删除（purgeSession）时一并清除。
 */
export type CompactionRecord = {
  id: string;
  sessionId: string;
  /** 第一条未被压缩的消息 id（摘要覆盖其之前的全部消息）。 */
  firstKeptMessageId: string;
  summary: string;
  snapshotId?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  modelId?: string;
  lastCompressedSequenceNo?: number;
  summaryHash?: string;
  triggerReason?: "budget" | "context_limit";
  createdAt: string;
};

export type SavedCompaction = { record: CompactionRecord; inserted: boolean };

export interface CompactionStore {
  save(record: CompactionRecord, coveredMessageCount?: number): SavedCompaction;
  latest(sessionId: string): CompactionRecord | null;
  list(sessionId: string): CompactionRecord[];
  count(sessionId: string): number;
}

export class InMemoryCompactionStore implements CompactionStore {
  private readonly rows: CompactionRecord[] = [];

  save(record: CompactionRecord, coveredMessageCount?: number): SavedCompaction {
    const duplicate = this.rows.find((row) =>
      row.sessionId === record.sessionId &&
      row.firstKeptMessageId === record.firstKeptMessageId &&
      row.summary === record.summary);
    if (duplicate) return { record: { ...duplicate }, inserted: false };
    const stored = { ...record, lastCompressedSequenceNo: coveredMessageCount };
    this.rows.push(stored);
    return { record: { ...stored }, inserted: true };
  }

  latest(sessionId: string): CompactionRecord | null {
    const matching = this.rows.filter((row) => row.sessionId === sessionId);
    const found = matching[matching.length - 1];
    return found ? { ...found } : null;
  }

  list(sessionId: string): CompactionRecord[] {
    return this.rows.filter((row) => row.sessionId === sessionId).map((row) => ({ ...row }));
  }

  count(sessionId: string): number {
    return this.rows.filter((row) => row.sessionId === sessionId).length;
  }
}
