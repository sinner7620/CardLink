import { getLocalDataByKey, isfileExists, MN, readJSON, setLocalDataByKey, writeTextFile } from "marginnote"
import { MistakeRecord, MistakeReviewCurves, nextReviewTime, sourceRecordKey } from "./mistake-domain"
import { recordRuntimeState } from "./note-navigation"
import { loadMatcherSettings } from "./settings"
import { cardLinkDocumentPath, ensureStorageDirectory, migrateLegacyFile } from "./storage-paths"

const STORAGE_KEY = "mn4-answer-matcher.mistakes.v2"
// 旧版把备份整份写在 NSUserDefaults（与主键同库双写，容灾为零）。
// 现在备份落在文档目录的真文件里，主存储损坏/丢失时可独立恢复。
const BACKUP_KEY = "marginnote.extension.mn4-answer-matcher.mistakes.v2"
const LEGACY_STORAGE_KEY = "mn4-answer-matcher.mistakes.v1"
const LEGACY_BACKUP_KEY = "marginnote.extension.mn4-answer-matcher.mistakes.v1"

function backupFilePath(slot = 0): string | undefined {
  try {
    const root = MN.app.documentPath
    if (!root) return undefined
    const name = slot === 0 ? "MN4错题库备份.json" : `MN4错题库备份-${slot}.json`
    const path = `${cardLinkDocumentPath("backups")}/${name}`
    ensureStorageDirectory(cardLinkDocumentPath("backups"))
    migrateLegacyFile(`${String(root).replace(/\/$/, "")}/${name}`, path)
    return path
  } catch {
    return undefined
  }
}

function backupFileValue(): unknown {
  for (const slot of [0, 1, 2]) {
    try {
      const path = backupFilePath(slot)
      if (path && isfileExists(path)) return readJSON(path)
    } catch {
      // 当前副本损坏时继续尝试更早的轮换副本。
    }
  }
  return undefined
}

let lastBackupRotationAt = 0
function writeBackupFile(serialized: string): void {
  try {
    const path = backupFilePath()
    if (!path) return
    const now = Date.now()
    // 主文件仍是最新恢复副本；每 15 分钟至多轮换一次，避免每道复习额外重写
    // 三份整库 JSON，同时保留逻辑误写前的两个历史落点。
    if (now - lastBackupRotationAt >= 15 * 60 * 1000 && isfileExists(path)) {
      const backup1 = backupFilePath(1)
      const backup2 = backupFilePath(2)
      if (backup1 && backup2 && isfileExists(backup1)) {
        try { writeTextFile(backup2, JSON.stringify(readJSON(backup1))) } catch {}
      }
      if (backup1) {
        try { writeTextFile(backup1, JSON.stringify(readJSON(path))) } catch {}
      }
      lastBackupRotationAt = now
    }
    writeTextFile(path, serialized)
  } catch {
    // 备份尽力而为，不得影响主写入。
  }
}

export interface MistakeState {
  version: 2
  records: Record<string, MistakeRecord>
}

let cachedState: MistakeState | undefined

// 人工刷新清理的历史记录单独留存，不与主库合并，避免再次复活。
export function archiveMistakeRecords(records: MistakeRecord[]): void {
  if (!records.length) return
  const key = "mn4-answer-matcher.mistakes.detached-archive.v1"
  const existing = getLocalDataByKey(key)
  const archive = existing ? (typeof existing === "string" ? JSON.parse(existing) : existing) : {}
  for (const record of records) archive[record.recordId] = { record, archivedAt: new Date().toISOString() }
  const serialized = JSON.stringify(archive)
  setLocalDataByKey(serialized, key)
  if (getLocalDataByKey(key) !== serialized) throw new Error("历史记录归档校验失败，已停止清理")
}

function emptyState(): MistakeState {
  return { version: 2, records: {} }
}

function plainObject(value: unknown): any {
  try {
    if (typeof value === "string") value = JSON.parse(value)
    return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : undefined
  } catch {
    return undefined
  }
}

function backupValue(key: string): unknown {
  try {
    return NSUserDefaults.standardUserDefaults().objectForKey(key)
  } catch {
    return undefined
  }
}

function normalizeRecord(value: any, curves: MistakeReviewCurves): MistakeRecord | undefined {
  if (!value?.sourceNotebookId || !value?.sourceNoteId) return
  const recordId = sourceRecordKey(String(value.sourceNotebookId), String(value.sourceNoteId))
  const createdAt = String(value.createdAt || new Date().toISOString())
  const legacyLevel = Number.isInteger(value.level) ? Number(value.level) : 0
  const usesThreeLevels = value.levelModel === 3
  const level = (usesThreeLevels
    ? legacyLevel >= 0 && legacyLevel <= 2 ? legacyLevel : 0
    : legacyLevel <= 1 ? 0 : legacyLevel <= 3 ? 1 : 2) as MistakeRecord["level"]
  const history = Array.isArray(value.history) ? value.history.map((item: any) => ({
    ...item,
    level: usesThreeLevels
      ? Number(item?.level) >= 0 && Number(item?.level) <= 2 ? Number(item.level) : 0
      : Number(item?.level) <= 1 ? 0 : Number(item?.level) <= 3 ? 1 : 2
  })) : []
  const updatedAt = String(value.updatedAt || value.lastReviewedAt || createdAt)
  const reviewCount = usesThreeLevels ? Number(value.reviewCount) || 0 : 0
  const scheduleBase = new Date(String(value.lastReviewedAt || updatedAt || createdAt))
  const hasThreeLevelSchedule = value.reviewScheduleModel === 3
  const nextReviewAt = hasThreeLevelSchedule && value.nextReviewAt
    ? String(value.nextReviewAt)
    : nextReviewTime(level, reviewCount, Number.isNaN(scheduleBase.getTime()) ? new Date(createdAt) : scheduleBase, curves).toISOString()
  return {
    ...value,
    recordId,
    sourceNotebookId: String(value.sourceNotebookId),
    sourceNoteId: String(value.sourceNoteId),
    sourceNotebookTitle: String(value.sourceNotebookTitle || "未命名脑图"),
    sourceRootNodeId: value.sourceRootNodeId ? String(value.sourceRootNodeId) : undefined,
    sourceRootTitle: value.sourceRootTitle ? String(value.sourceRootTitle) : undefined,
    sourceTitle: String(value.sourceTitle || "未命名错题"),
    sourcePathTitles: Array.isArray(value.sourcePathTitles) ? value.sourcePathTitles.map(String) : [],
    categoryPath: Array.isArray(value.categoryPath) && value.categoryPath.length
      ? value.categoryPath.map(String)
      : [String(value.sourceNotebookTitle || "未命名脑图"), ...(value.sourcePathTitles || []).map(String)],
    manualCategory: value.manualCategory ? String(value.manualCategory) : undefined,
    manualCategories: Array.isArray(value.manualCategories)
      ? value.manualCategories.map(String)
      : value.manualCategory
        ? [String(value.manualCategory)]
        : [],
    level,
    levelModel: 3,
    reviewScheduleModel: 3,
    createdAt,
    updatedAt,
    nextReviewAt,
    reviewCount,
    history,
    reviewCompleted: value.reviewCompleted === true || (!usesThreeLevels && value.reviewCompleted === undefined && legacyLevel === 5),
    legacyMistakeNoteId: value.legacyMistakeNoteId || value.mistakeNoteId || undefined
  } as MistakeRecord
}

function stateFrom(value: unknown, curves: MistakeReviewCurves): MistakeState | undefined {
  const source = plainObject(value)
  if (!source?.records || typeof source.records !== "object") return
  const records: Record<string, MistakeRecord> = {}
  for (const candidate of Object.values(source.records)) {
    const record = normalizeRecord(candidate, curves)
    if (record) records[record.recordId] = record
  }
  return { version: 2, records }
}

export function loadMistakeState(): MistakeState {
  if (cachedState) return cachedState
  const curves = loadMatcherSettings().mistakeReviewCurves
  const primary = stateFrom(getLocalDataByKey(STORAGE_KEY), curves)
  if (primary) return cachedState = primary
  // 主存储缺失/损坏时按新旧程度依次恢复（回退而非合并：合并会让已删除的
  // 记录在冷启动时从备份复活）。恢复出的状态立即写回，使主键与备份重新对齐。
  const legacyBackup = stateFrom(backupValue(BACKUP_KEY), curves)
  if (legacyBackup) return cachedState = restoreState(legacyBackup)
  const fileBackup = stateFrom(backupFileValue(), curves)
  if (fileBackup) return cachedState = restoreState(fileBackup)
  const legacy = stateFrom(getLocalDataByKey(LEGACY_STORAGE_KEY), curves) ??
    stateFrom(backupValue(LEGACY_BACKUP_KEY), curves)
  if (!legacy) return cachedState = emptyState()
  // Persist migration immediately so removing a record later cannot resurrect it
  // from the read-only v1 store on the next load.
  return cachedState = restoreState(legacy)
}

function restoreState(state: MistakeState): MistakeState {
  saveMistakeState(state)
  return state
}

export function saveMistakeState(state: MistakeState): void {
  const saveStartedAt = Date.now()
  const serialized = JSON.stringify({ version: 2, records: state.records })
  cachedState = state
  setLocalDataByKey(serialized, STORAGE_KEY)
  // 备份写文档目录的真文件（原 NSUserDefaults 备份键只读兼容旧数据，不再写入）。
  writeBackupFile(serialized)
  cleanupLegacyKeys()
  recordRuntimeState("错题存储", "save 完成", `durationMs=${Date.now() - saveStartedAt} bytes=${serialized.length} records=${Object.keys(state.records).length}`)
}

/**
 * 主存储与备份均健康时，把不再参与的迁移源键置空：旧版 NSUserDefaults 备份、
 * v1 数据、以及历史上"只写不读"的快照键。它们可能各占 MB 级，且永远不会再被读取。
 */
function cleanupLegacyKeys(): void {
  try {
    const defaults = NSUserDefaults.standardUserDefaults()
    for (const key of [BACKUP_KEY, LEGACY_BACKUP_KEY]) {
      if (backupValue(key) !== undefined) defaults.setObjectForKey("", key)
    }
    for (const key of [LEGACY_STORAGE_KEY, "marginnote.extension.mn4-answer-matcher.mistakes.snapshot.v1"]) {
      if (getLocalDataByKey(key)) setLocalDataByKey("", key)
    }
  } catch {
    // 清理失败不影响正确性；下次保存会再试。
  }
}

export function upsertMistakeRecord(state: MistakeState, record: MistakeRecord): void {
  state.records[record.recordId] = record
}

export function removeMistakeRecord(state: MistakeState, recordId: string): void {
  delete state.records[recordId]
}

export function recordForSource(state: MistakeState, notebookId: string, noteId: string): MistakeRecord | undefined {
  return state.records[sourceRecordKey(notebookId, noteId)]
}
