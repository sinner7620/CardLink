import { LEVEL_DESCRIPTIONS, MistakeLevel } from "./mistake-domain"

/** v3 标签方案：三档标签统一带「错题_」前缀，不再写入单独的「错题」标签。 */
export const MISTAKE_LEVEL_TAG_PREFIX = "错题_"

const NEW_LEVEL_TAGS: Record<string, MistakeLevel> = {
  "错题_不会": 0,
  "错题_不熟": 1,
  "错题_掌握": 2
}

export function mistakeLevelTag(level: MistakeLevel): string {
  return `${MISTAKE_LEVEL_TAG_PREFIX}${LEVEL_DESCRIPTIONS[level]}`
}

function migrateLegacyLevel(value: number): MistakeLevel {
  return value <= 1 ? 0 : value <= 3 ? 1 : 2
}

export function legacyMistakeLevelFromTags(tags: string[] | undefined | null): MistakeLevel | undefined {
  for (const tag of cleanMistakeTags(tags)) {
    if (NEW_LEVEL_TAGS[tag] !== undefined) return NEW_LEVEL_TAGS[tag]
    const combined: Record<string, MistakeLevel> = { 错题不会: 0, 错题不熟: 1, 错题掌握: 2 }
    if (combined[tag] !== undefined) return combined[tag]
    const numbered = /^错题([0-5])级$/.exec(tag)
    if (numbered) return migrateLegacyLevel(Number(numbered[1]))
    const state = /^错题状态·S([0-5])$/.exec(tag)
    if (state) return migrateLegacyLevel(Number(state[1]))
  }
  return undefined
}

export function hasLegacyMistakeLevelTag(tags: string[] | undefined | null): boolean {
  return cleanMistakeTags(tags).some(tag =>
    /^错题(?:不会|不熟|掌握)$/.test(tag) || /^错题[0-5]级$/.test(tag) || /^错题状态·S[0-5]$/.test(tag))
}

/** 是否仍包含需要改写为当前「错题_等级」方案的旧托管标签。 */
export function hasLegacyManagedMistakeTag(tags: string[] | undefined | null): boolean {
  return cleanMistakeTags(tags).some(tag => tag === "错题" ||
    /^错题(?:不会|不熟|掌握)$/.test(tag) || /^错题[0-5]级$/.test(tag) || /^错题状态·S[0-5]$/.test(tag))
}

export function cleanMistakeCategoryTag(value: string): string {
  return String(value ?? "").replace(/[\n\r#]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40)
}

/** 归一化标签列表：接受单个字符串或数组，去 #、去空白、去重。 */
export function cleanMistakeTags(value: string | string[] | undefined | null): string[] {
  const list = Array.isArray(value) ? value : [value ?? ""]
  return Array.from(new Set(list.map(cleanMistakeCategoryTag).filter(Boolean)))
}

export function isManagedMistakeTag(value: string): boolean {
  const tag = cleanMistakeCategoryTag(value)
  return tag === "错题" || // 已退役的旧版托管标签，仍需被识别以便迁移和清除
    /^错题(?:不会|不熟|掌握)$/.test(tag) || // 旧版
    /^错题_(?:不会|不熟|掌握)$/.test(tag) || // 当前方案
    /^错题[0-5]级$/.test(tag) ||
    /^错题状态·S[0-5]$/.test(tag) ||
    /^错题分类[·.。]/.test(tag)
}

/** 从 MarginNote 卡片标签解析出的可恢复错题状态。 */
export interface MistakeSourceTagState {
  isMistake: boolean
  level?: MistakeLevel
  customTags: string[]
}

/**
 * 从 MarginNote 卡片标签恢复错题身份与等级。
 * 优先识别当前「错题_不会/不熟/掌握」三档，同时兼容全部历史方案：
 * 「错题N级」「错题状态·SN」「错题不会」组合、单独「错题」标记。
 */
export function mistakeStateFromSourceTags(tags: string[] | undefined | null): MistakeSourceTagState {
  const clean = cleanMistakeTags(tags)
  let level: MistakeLevel | undefined

  const namedLevels: Record<string, MistakeLevel> = {
    ...NEW_LEVEL_TAGS,
    错题不会: 0, 错题不熟: 1, 错题掌握: 2
  }
  for (const tag of clean) {
    if (namedLevels[tag] !== undefined) {
      level = namedLevels[tag]
      break
    }
  }

  for (const tag of level === undefined ? clean : []) {
    const match = /^错题([0-5])级$/.exec(tag)
    if (match) {
      level = migrateLegacyLevel(Number(match[1]))
      break
    }
  }
  if (level === undefined) {
    for (const tag of clean) {
      const match = /^错题状态·S([0-5])$/.exec(tag)
      if (match) {
        level = migrateLegacyLevel(Number(match[1]))
        break
      }
    }
  }

  return {
    isMistake: clean.includes("错题") || level !== undefined,
    level,
    customTags: clean.filter(tag => !isManagedMistakeTag(tag))
  }
}

/** 从 MarginNote 卡片当前标签反向提取用户标签，系统维护的错题标签不进入自定义标签。 */
export function customMistakeTagsFromSource(tags: string[] | undefined | null): string[] {
  return mistakeStateFromSourceTags(tags).customTags
}

function withoutManagedTags(tags: string[], categories: string[]): string[] {
  const custom = new Set(categories.map(cleanMistakeCategoryTag).filter(Boolean))
  return tags.filter(tag => !isManagedMistakeTag(tag) && !custom.has(cleanMistakeCategoryTag(tag)))
}

export function mistakeSourceTags(
  tags: string[],
  level: MistakeLevel,
  categories?: string | string[],
  previousCategories?: string | string[]
): string[] {
  const clean = cleanMistakeTags(categories)
  const managed = cleanMistakeTags([
    ...(Array.isArray(categories) ? categories : [categories ?? ""]),
    ...(Array.isArray(previousCategories) ? previousCategories : [previousCategories ?? ""])
  ])
  return Array.from(new Set([
    ...withoutManagedTags(tags, managed),
    mistakeLevelTag(level),
    ...clean
  ]))
}

export function withoutMistakeSourceTags(tags: string[], categories?: string | string[]): string[] {
  return withoutManagedTags(tags, cleanMistakeTags(categories))
}
