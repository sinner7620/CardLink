import { getLocalDataByKey, setLocalDataByKey } from "marginnote"
import { MistakeReviewCurves } from "./mistake-domain"
import { normalizeMistakeReviewCurves } from "./mistake-review-settings"

export { normalizeMistakeReviewCurves } from "./mistake-review-settings"

const SETTINGS_KEY = "mn4-answer-matcher.settings.v1"

export interface MatcherSettings {
  allowSameStudySetMindMap: boolean
  mistakeReviewCurves: MistakeReviewCurves
  mistakeCustomCategories: string[]
  debugModeEnabled: boolean
  cardToolbarEnabled: boolean
}

export function normalizeMistakeCustomCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map(item => String(item ?? "").replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean)))
    .slice(-100)
}

// 会话级缓存：loadMatcherSettings 是高频读（桥接/诊断热路径），避免每次存储往返。
// 写入经 saveMatcherSettings 时同步更新缓存；跨场景生命周期由 MN 重启自然重置。
let settingsCache: MatcherSettings | undefined

export function loadMatcherSettings(): MatcherSettings {
  if (settingsCache) return settingsCache
  const value = getLocalDataByKey(SETTINGS_KEY) as Partial<MatcherSettings> | undefined
  settingsCache = {
    allowSameStudySetMindMap: value?.allowSameStudySetMindMap === true,
    mistakeReviewCurves: normalizeMistakeReviewCurves(value?.mistakeReviewCurves),
    mistakeCustomCategories: normalizeMistakeCustomCategories(value?.mistakeCustomCategories),
    debugModeEnabled: value?.debugModeEnabled === true,
    cardToolbarEnabled: value?.cardToolbarEnabled !== false
  }
  return settingsCache
}

export function saveMatcherSettings(settings: Partial<MatcherSettings>): void {
  // 原子写：合并基于缓存一次性构造完整对象后覆盖，消除"读旧→写新"交错窗口
  const current = settingsCache ?? loadMatcherSettings()
  const next = {
    ...current,
    ...settings,
    mistakeReviewCurves: normalizeMistakeReviewCurves(settings.mistakeReviewCurves ?? current.mistakeReviewCurves),
    mistakeCustomCategories: normalizeMistakeCustomCategories(settings.mistakeCustomCategories ?? current.mistakeCustomCategories)
  }
  setLocalDataByKey(next, SETTINGS_KEY)
  settingsCache = next
}
