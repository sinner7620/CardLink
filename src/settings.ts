import { getLocalDataByKey, setLocalDataByKey } from "marginnote"
import { MistakeReviewCurves } from "./mistake-domain"
import { normalizeMistakeReviewCurves } from "./mistake-review-settings"

export { normalizeMistakeReviewCurves } from "./mistake-review-settings"

const SETTINGS_KEY = "mn4-answer-matcher.settings.v1"

export interface MatcherSettings {
  globalQuestionColors?: number[]
  allowSameStudySetMindMap: boolean
  mistakeReviewCurves: MistakeReviewCurves
  mistakeCustomCategories: string[]
  sceneWorkbenchEnabled: boolean
  debugModeEnabled: boolean
  debugReviewAlgorithm?: "fixed" | "fsrs"
  debugAnswerPreviewMode?: "custom" | "native"
  debugUpdateDownloadsEnabled: boolean
  debugAutoInstallUpdatesEnabled: boolean
  cardToolbarEnabled: boolean
  sourceLocateMode: "locate" | "focus"
  subcardAnswerDisplay: "reveal" | "window"
  boundHandwritingDisplay: "always" | "doubleTap"
  mistakeListDisplay: "always" | "autoHide"
  entranceDefaultMode: "practice" | "clipper"
  answerMaskStyle: "dark" | "light"
  answerMaskColor: string
  answerMaskImage: string
  autoCollapseComments: boolean
  reviewExpandedCommentCount: number
  reviewCompletionConfetti: boolean
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
    globalQuestionColors: normalizeQuestionColors(value?.globalQuestionColors),
    allowSameStudySetMindMap: value?.allowSameStudySetMindMap !== false,
    mistakeReviewCurves: normalizeMistakeReviewCurves(value?.mistakeReviewCurves),
    mistakeCustomCategories: normalizeMistakeCustomCategories(value?.mistakeCustomCategories),
    sceneWorkbenchEnabled: value?.sceneWorkbenchEnabled === true,
    debugModeEnabled: value?.debugModeEnabled === true,
    debugReviewAlgorithm: value?.debugReviewAlgorithm === "fsrs" ? "fsrs" : "fixed",
    debugAnswerPreviewMode: value?.debugAnswerPreviewMode === "native" ? "native" : "custom",
    debugUpdateDownloadsEnabled: value?.debugModeEnabled === true && value?.debugUpdateDownloadsEnabled === true,
    debugAutoInstallUpdatesEnabled: value?.debugModeEnabled === true && value?.debugAutoInstallUpdatesEnabled === true,
    cardToolbarEnabled: value?.cardToolbarEnabled !== false,
    sourceLocateMode: value?.sourceLocateMode === "focus" ? "focus" : "locate",
    subcardAnswerDisplay: value?.subcardAnswerDisplay === "reveal" ? "reveal" : "window",
    boundHandwritingDisplay: value?.boundHandwritingDisplay === "always" ? "always" : "doubleTap",
    mistakeListDisplay: value?.mistakeListDisplay === "autoHide" ? "autoHide" : "always",
    entranceDefaultMode: value?.entranceDefaultMode === "clipper" ? "clipper" : "practice",
    answerMaskStyle: value?.answerMaskStyle === "light" ? "light" : "dark",
    answerMaskColor: /^#[0-9a-f]{6}$/i.test(value?.answerMaskColor ?? "") ? String(value?.answerMaskColor) : value?.answerMaskStyle === "light" ? "#d9e4f2" : "#141922",
    answerMaskImage: typeof value?.answerMaskImage === "string" && value.answerMaskImage.startsWith("data:image/") ? value.answerMaskImage : "",
    autoCollapseComments: value?.autoCollapseComments === true,
    reviewExpandedCommentCount: Number.isInteger(value?.reviewExpandedCommentCount) ? Math.max(0, Math.min(10, Number(value?.reviewExpandedCommentCount))) : 2,
    reviewCompletionConfetti: value?.reviewCompletionConfetti !== false
  }
  return settingsCache
}

export function saveMatcherSettings(settings: Partial<MatcherSettings>): void {
  // 原子写：合并基于缓存一次性构造完整对象后覆盖，消除"读旧→写新"交错窗口
  const current = settingsCache ?? loadMatcherSettings()
  const next = {
    ...current,
    ...settings,
    globalQuestionColors: normalizeQuestionColors(settings.globalQuestionColors ?? current.globalQuestionColors),
    debugAnswerPreviewMode: settings.debugAnswerPreviewMode === "native" || settings.debugAnswerPreviewMode === "custom" ? settings.debugAnswerPreviewMode : current.debugAnswerPreviewMode,
    debugUpdateDownloadsEnabled: (settings.debugModeEnabled ?? current.debugModeEnabled) === true && (settings.debugUpdateDownloadsEnabled ?? current.debugUpdateDownloadsEnabled) === true,
    debugAutoInstallUpdatesEnabled: (settings.debugModeEnabled ?? current.debugModeEnabled) === true && (settings.debugAutoInstallUpdatesEnabled ?? current.debugAutoInstallUpdatesEnabled) === true,
    sceneWorkbenchEnabled: typeof settings.sceneWorkbenchEnabled === "boolean" ? settings.sceneWorkbenchEnabled : current.sceneWorkbenchEnabled,
    boundHandwritingDisplay: settings.boundHandwritingDisplay === "always" || settings.boundHandwritingDisplay === "doubleTap" ? settings.boundHandwritingDisplay : current.boundHandwritingDisplay,
    mistakeListDisplay: settings.mistakeListDisplay === "always" || settings.mistakeListDisplay === "autoHide" ? settings.mistakeListDisplay : current.mistakeListDisplay,
    entranceDefaultMode: settings.entranceDefaultMode === "practice" || settings.entranceDefaultMode === "clipper" ? settings.entranceDefaultMode : current.entranceDefaultMode,
    mistakeReviewCurves: normalizeMistakeReviewCurves(settings.mistakeReviewCurves ?? current.mistakeReviewCurves),
    mistakeCustomCategories: normalizeMistakeCustomCategories(settings.mistakeCustomCategories ?? current.mistakeCustomCategories),
    sourceLocateMode: settings.sourceLocateMode === "focus" ? "focus" : settings.sourceLocateMode === "locate" ? "locate" : current.sourceLocateMode,
    subcardAnswerDisplay: settings.subcardAnswerDisplay === "reveal" ? "reveal" : settings.subcardAnswerDisplay === "window" ? "window" : current.subcardAnswerDisplay,
    answerMaskStyle: settings.answerMaskStyle === "light" ? "light" : settings.answerMaskStyle === "dark" ? "dark" : current.answerMaskStyle,
    answerMaskColor: /^#[0-9a-f]{6}$/i.test(settings.answerMaskColor ?? "") ? settings.answerMaskColor! : current.answerMaskColor,
    answerMaskImage: settings.answerMaskImage === undefined ? current.answerMaskImage : settings.answerMaskImage,
    autoCollapseComments: settings.autoCollapseComments === undefined ? current.autoCollapseComments : settings.autoCollapseComments === true,
    reviewExpandedCommentCount: Number.isInteger(settings.reviewExpandedCommentCount) ? Math.max(0, Math.min(10, settings.reviewExpandedCommentCount!)) : current.reviewExpandedCommentCount,
    reviewCompletionConfetti: typeof settings.reviewCompletionConfetti === 'boolean' ? settings.reviewCompletionConfetti : current.reviewCompletionConfetti
  }
  setLocalDataByKey(next, SETTINGS_KEY)
  settingsCache = next
}

export function normalizeQuestionColors(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter(v => Number.isInteger(v) && v >= 0 && v < 16))] : []
}
