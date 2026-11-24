/**
 * 快照导出契约类型（§6.3 / §13 导入 API 的载荷形态）。
 * 实现与校验在 snapshot-importer.ts；本文件作为插件侧导出器对接的稳定类型入口。
 */
export {
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotExportPayload,
  type SnapshotExportRecord,
  type PluginBackupPayload,
} from "./snapshot-importer.ts";
