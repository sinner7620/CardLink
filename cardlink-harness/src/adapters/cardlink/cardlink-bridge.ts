import type { SnapshotExportPayload } from "./snapshot-export-contract.ts";

/**
 * CardLinkBridge（§3/§19.1）：未来在线桥接的预留接口。
 * H1 v1 只启用快照导入；出口形态（只读 rails 导出命令 vs 文件快照）按 P0 实测决定，
 * 在验证完成前本接口不得被任何路径调用。
 */
export interface CardLinkBridge {
  /** 从 MarginNote 侧读取并导出全量快照（只读）。 */
  exportSnapshot(): Promise<SnapshotExportPayload>;
}

export function createCardLinkBridge(): never {
  throw new Error(
    "CardLinkBridge 在 H1 v1 未启用（规范 §19.1 待 P0 实测）。请使用快照导入：POST /h1/import/cardlink-snapshot 或 CLI import。",
  );
}
