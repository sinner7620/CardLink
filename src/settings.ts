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
  sourceLocateMode: "locate" | "focus"
  subcardAnswerDisplay: "reveal" | "window"
  boundHandwritingDisplay: "always" | "doubleTap"
  mistakeListDisplay: "always" | "autoHide"
  answerMaskStyle: "dark" | "light"
  answerMaskColor: string
  answerMaskImage: string
  autoCollapseComments: boolean
  reviewExpandedCommentCount: number
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
    allowSameStudySetMindMap: value?.allowSameStudySetMindMap !== false,
    mistakeReviewCurves: normalizeMistakeReviewCurves(value?.mistakeReviewCurves),
    mistakeCustomCategories: normalizeMistakeCustomCategories(value?.mistakeCustomCategories),
    debugModeEnabled: value?.debugModeEnabled === true,
    cardToolbarEnabled: value?.cardToolbarEnabled !== false,
    sourceLocateMode: value?.sourceLocateMode === "focus" ? "focus" : "locate",
    subcardAnswerDisplay: value?.subcardAnswerDisplay === "reveal" ? "reveal" : "window",
    boundHandwritingDisplay: value?.boundHandwritingDisplay === "always" ? "always" : "doubleTap",
    mistakeListDisplay: value?.mistakeListDisplay === "autoHide" ? "autoHide" : "always",
    answerMaskStyle: value?.answerMaskStyle === "light" ? "light" : "dark",
    answerMaskColor: /^#[0-9a-f]{6}$/i.test(value?.answerMaskColor ?? "") ? String(value?.answerMaskColor) : value?.answerMaskStyle === "light" ? "#d9e4f2" : "#141922",
    answerMaskImage: typeof value?.answerMaskImage === "string" && value.answerMaskImage.startsWith("data:image/") ? value.answerMaskImage : "",
    autoCollapseComments: value?.autoCollapseComments === true,
    reviewExpandedCommentCount: Number.isInteger(value?.reviewExpandedCommentCount) ? Math.max(0, Math.min(10, Number(value?.reviewExpandedCommentCount))) : 2
  }
  return settingsCache
}

export function saveMatcherSettings(settings: Partial<MatcherSettings>): void {
  // 原子写：合并基于缓存一次性构造完整对象后覆盖，消除"读旧→写新"交错窗口
  const current = settingsCache ?? loadMatcherSettings()
  const next = {
    ...current,
    ...settings,
    boundHandwritingDisplay: settings.boundHandwritingDisplay === "always" || settings.boundHandwritingDisplay === "doubleTap" ? settings.boundHandwritingDisplay : current.boundHandwritingDisplay,
    mistakeListDisplay: settings.mistakeListDisplay === "always" || settings.mistakeListDisplay === "autoHide" ? settings.mistakeListDisplay : current.mistakeListDisplay,
    mistakeReviewCurves: normalizeMistakeReviewCurves(settings.mistakeReviewCurves ?? current.mistakeReviewCurves),
    mistakeCustomCategories: normalizeMistakeCustomCategories(settings.mistakeCustomCategories ?? current.mistakeCustomCategories),
    sourceLocateMode: settings.sourceLocateMode === "focus" ? "focus" : settings.sourceLocateMode === "locate" ? "locate" : current.sourceLocateMode,
    subcardAnswerDisplay: settings.subcardAnswerDisplay === "reveal" ? "reveal" : settings.subcardAnswerDisplay === "window" ? "window" : current.subcardAnswerDisplay,
    answerMaskStyle: settings.answerMaskStyle === "light" ? "light" : settings.answerMaskStyle === "dark" ? "dark" : current.answerMaskStyle,
    answerMaskColor: /^#[0-9a-f]{6}$/i.test(settings.answerMaskColor ?? "") ? settings.answerMaskColor! : current.answerMaskColor,
    answerMaskImage: settings.answerMaskImage === undefined ? current.answerMaskImage : settings.answerMaskImage,
    autoCollapseComments: settings.autoCollapseComments === undefined ? current.autoCollapseComments : settings.autoCollapseComments === true,
    reviewExpandedCommentCount: Number.isInteger(settings.reviewExpandedCommentCount) ? Math.max(0, Math.min(10, settings.reviewExpandedCommentCount!)) : current.reviewExpandedCommentCount
  }
  setLocalDataByKey(next, SETTINGS_KEY)
  settingsCache = next
}
