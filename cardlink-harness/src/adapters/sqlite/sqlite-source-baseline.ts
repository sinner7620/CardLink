import type { SqlDriver } from "./db.ts";

/**
 * v2.16 §6.3：本地源投影指纹基线。
 * 基线只在该次导入**成功返回快照后**由调用方写入（runtime 同步路径），
 * 因此导入失败不会改变基线；重启后从 SQLite 读取，不依赖内存状态。
 */
export type SourceBaseline = {
  sourceId: string;
  fingerprint: string;
  snapshotId: string;
  updatedAt: string;
};

export class SqliteSourceBaselineStore {
  constructor(private readonly driver: SqlDriver) {}

  get(sourceId: string): SourceBaseline | null {
    const row = this.driver.rows(
      "SELECT source_id, fingerprint, snapshot_id, updated_at FROM source_baselines WHERE source_id = ?",
      [sourceId],
    )[0] as { source_id: string; fingerprint: string; snapshot_id: string; updated_at: string } | undefined;
    return row
      ? { sourceId: row.source_id, fingerprint: row.fingerprint, snapshotId: row.snapshot_id, updatedAt: row.updated_at }
      : null;
  }

  set(sourceId: string, fingerprint: string, snapshotId: string): SourceBaseline {
    const updatedAt = new Date().toISOString();
    this.driver.exec(
      `INSERT INTO source_baselines(source_id, fingerprint, snapshot_id, updated_at) VALUES(?,?,?,?)
       ON CONFLICT(source_id) DO UPDATE SET fingerprint = excluded.fingerprint,
         snapshot_id = excluded.snapshot_id, updated_at = excluded.updated_at`,
      [sourceId, fingerprint, snapshotId, updatedAt],
    );
    return { sourceId, fingerprint, snapshotId, updatedAt };
  }
}
