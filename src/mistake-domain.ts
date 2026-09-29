export type MistakeLevel = 0 | 1 | 2

export interface MistakeHistoryItem {
  at: string
  level: MistakeLevel
}

export interface MistakeRecord {
  /** Stable identity. Never use title alone: duplicate titles are common across notebooks. */
  recordId: string
  sourceNoteId: string
  sourceNotebookId: string
  sourceNotebookTitle: string
  sourceRootNodeId?: string
  sourceRootTitle?: string
  sourceTitle: string
  sourcePathTitles: string[]
  categoryPath: string[]
  manualCategory?: string
  manualCategories?: string[]
  /** 收藏使用稳定 recordId 归属，不能由标题推断。 */
  favorite?: boolean
  /** 最近一次显式核对原卡时的可用性；普通 dashboard 不为此逐条查询数据库。 */
  sourceAvailable?: boolean
  answerNotebookId?: string
  answerRootNodeId?: string
  level: MistakeLevel
  /** 3 表示记录已使用三档等级，避免再次按旧六级规则迁移。 */
  levelModel?: 3
  /** 3 表示 nextReviewAt 已按三档复习曲线计算。 */
  reviewScheduleModel?: 3
  createdAt: string
  updatedAt: string
  lastReviewedAt?: string
  nextReviewAt: string
  reviewCount: number
  history: MistakeHistoryItem[]
  /** 掌握连续确认两次后停止自动复习；错题记录与历史仍然保留。 */
  reviewCompleted?: boolean
  /** 卡片托管标签最近一次确认写入成功的时间；缺失表示卡片上可能从未写过标签。 */
  tagsWrittenAt?: string
  /** v1 migration hint only. New records never clone a card into a mistake notebook. */
  legacyMistakeNoteId?: string
}

function cleanPart(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

export function sourceRecordKey(sourceNotebookId: string, sourceNoteId: string): string {
  return `${sourceNotebookId}:${sourceNoteId}`
}

export function mistakeCategoryPath(record: MistakeRecord): string[] {
  const manual = cleanPart(record.manualCategory ?? record.manualCategories?.[0] ?? "")
  if (manual) return [manual]
  const stored = (record.categoryPath ?? []).map(cleanPart).filter(Boolean)
  if (stored.length) return stored
  return [
    cleanPart(record.sourceNotebookTitle) || "未命名脑图",
    ...(record.sourcePathTitles ?? []).map(cleanPart).filter(Boolean)
  ]
}

export function automaticCategoryPath(record: MistakeRecord): string[] {
  const stored = (record.categoryPath ?? []).map(cleanPart).filter(Boolean)
  if (stored.length) return stored
  return [
    cleanPart(record.sourceNotebookTitle) || "未命名脑图",
    ...(record.sourcePathTitles ?? []).map(cleanPart).filter(Boolean)
  ]
}

export interface MistakeCategoryOption {
  key: string
  label: string
  depth: number
}

export function categoryPathPrefixes(path: string[]): MistakeCategoryOption[] {
  const clean = path.map(cleanPart).filter(Boolean)
  return clean.map((_, index) => {
    const prefix = clean.slice(0, index + 1)
    return {
      key: `path:${prefix.join("\u001f")}`,
      label: prefix.join(" › "),
      depth: index
    }
  })
}

export function mistakeCategoryLabel(record: MistakeRecord): string {
  // categoryLabel is rendered as the source path under a question title.
  // Custom tags have their own field and must never replace that source path.
  return automaticCategoryPath(record).slice(0, 3).join(" › ") || "未分类"
}

/** 记录的当前标签列表：优先 manualCategories，旧记录回退到单个 manualCategory。 */
export function manualTagsOf(record: Pick<MistakeRecord, "manualCategories" | "manualCategory"> | undefined): string[] {
  if (!record) return []
  if (record.manualCategories?.length) return record.manualCategories
  return record.manualCategory ? [record.manualCategory] : []
}

// Collator 构造成本高：模块级单例，避免每次比较都分配（P4-4）
const zhCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })

export function compareMistakeRecords(a: MistakeRecord, b: MistakeRecord): number {
  const collator = zhCollator
  const path = collator.compare(mistakeCategoryPath(a).join("\u0000"), mistakeCategoryPath(b).join("\u0000"))
  if (path) return path
  const title = collator.compare(a.sourceTitle, b.sourceTitle)
  if (title) return title
  return a.createdAt.localeCompare(b.createdAt) || a.recordId.localeCompare(b.recordId)
}

export const LEVEL_DESCRIPTIONS: Record<MistakeLevel, string> = {
  0: "不会",
  1: "不熟",
  2: "掌握"
}

export type MistakeReviewCurves = Record<MistakeLevel, number[]>

export const REVIEW_CURVES: MistakeReviewCurves = {
  0: [1, 3, 7],
  1: [2, 5, 10],
  2: [14]
}

export function isMistakeLevel(value: number): value is MistakeLevel {
  return Number.isInteger(value) && value >= 0 && value <= 2
}

export function nextReviewTime(
  level: MistakeLevel,
  reviewCount: number,
  from = new Date(),
  curves: MistakeReviewCurves = REVIEW_CURVES
): Date {
  const curve = curves[level]
  const days = curve[Math.min(Math.max(0, reviewCount), curve.length - 1)]
  return new Date(from.getTime() + days * 86400000)
}

export interface NewMistakeInput {
  sourceNoteId: string
  sourceNotebookId: string
  sourceNotebookTitle: string
  sourceRootNodeId?: string
  sourceRootTitle?: string
  sourceTitle: string
  sourcePathTitles: string[]
  categoryPath?: string[]
  manualCategory?: string
  manualCategories?: string[]
  answerNotebookId?: string
  answerRootNodeId?: string
  level: MistakeLevel
  legacyMistakeNoteId?: string
}

export function createMistakeRecord(
  input: NewMistakeInput,
  now = new Date(),
  curves: MistakeReviewCurves = REVIEW_CURVES
): MistakeRecord {
  const at = now.toISOString()
  return {
    ...input,
    levelModel: 3,
    reviewScheduleModel: 3,
    recordId: sourceRecordKey(input.sourceNotebookId, input.sourceNoteId),
    categoryPath: input.categoryPath?.length
      ? input.categoryPath
      : [input.sourceNotebookTitle, ...input.sourcePathTitles],
    createdAt: at,
    updatedAt: at,
    nextReviewAt: nextReviewTime(input.level, 0, now, curves).toISOString(),
    reviewCount: 0,
    reviewCompleted: false,
    history: [{ at, level: input.level }]
  }
}

export function reviewMistake(
  record: MistakeRecord,
  level: MistakeLevel,
  now = new Date(),
  curves: MistakeReviewCurves = REVIEW_CURVES
): MistakeRecord {
  const sameLevel = level === record.level
  const reviewCount = sameLevel ? record.reviewCount + 1 : 0
  const reviewCompleted = level === 2 && sameLevel && reviewCount >= 1
  const at = now.toISOString()
  return {
    ...record,
    level,
    reviewCount,
    updatedAt: at,
    lastReviewedAt: at,
    nextReviewAt: nextReviewTime(level, reviewCount, now, curves).toISOString(),
    reviewCompleted,
    history: [...record.history, { at, level }]
  }
}

export function isDue(record: MistakeRecord, now = new Date()): boolean {
  if (record.reviewCompleted === true) return false
  // 到期口径（全插件统一）：本地今天 24 点前到期即视为到期（含已逾期）。
  // 与待复习页"今日队列"、顶部徽标同口径；严格时刻判定会造成
  // "总览/提醒/导出 不计入，但待复习页计入"的口径分裂。
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return new Date(record.nextReviewAt).getTime() < endOfDay
}

export function resumeMistakeReview(
  record: MistakeRecord,
  now = new Date(),
  curves: MistakeReviewCurves = REVIEW_CURVES
): MistakeRecord {
  const at = now.toISOString()
  return {
    ...record,
    reviewCount: 0,
    reviewCompleted: false,
    updatedAt: at,
    nextReviewAt: nextReviewTime(record.level, 0, now, curves).toISOString()
  }
}
