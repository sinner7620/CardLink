import "./platform/webview-compat"
import { AcrylicSurface } from "./AcrylicSurface"
import DistributionDonut from "./DistributionDonut"
import { OCRDatabase } from './OCRDatabase'
import { OCRBackground } from './OCRCapture'
import "./ui/distribution-glow.css"
import LocalCacheSettings from "./LocalCacheSettings"
import ExportFilters, { FilterSection, FilterChoices } from "./ExportFilters"
import { matchesExportFilters } from "../../src/export-filters"
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { TemplateConverter } from "./TemplateConverter"
import { createRoot } from "react-dom/client"
import MNBridge from "./lib/mnBridge"
import { installMistakeCardDrag } from "./lib/mistakeCardDrag"
import "./ui/agent-panel.css"
import "./ui/agent-settings.css"
import { AgentPanel } from "./AgentPanel"
import { HarnessSettings } from "./HarnessSettings"
import { HarnessSyncCard } from "./HarnessSyncCard"
import { HarnessErrorBoundary } from "./HarnessErrorBoundary"
import { Icon } from "./icons"
import { ReviewQueueFilters } from "./ReviewQueueFilters"
import { ReviewStartButton } from "./ReviewStartButton"
import { reviewDayStatus, sortReviewRecords } from "./lib/reviewQueueControls"
import { buildMindMapOptions, buildParentInsights, sourceInsightKey } from "../../src/source-insights"
import { REVIEW_CURVES } from "../../src/mistake-domain"
import { filterableMistakeTags } from "../../src/export-filters"
import { isManagedMistakeTag } from "../../src/mistake-tags"
import { escapeHtml } from "../../src/html-utils"
import { installWebUiColors } from "../../src/ui-tokens"
import { normalizeUpdatePrompt } from "../../src/update-prompt"
import { UpdatePromptMarkdown } from "./components/UpdatePromptMarkdown"
import "./ui/b21-baseline.css"
import "./ui/selection.css"
import "./ui/export-select.css"
import "./ui/sticky-toolbars.css"
import "./ui/mistake-search.css"
import "./ui/error-reasons.css"
import { useDockableBar } from "./detail-dock"
import { CardPreview } from "./CardPreview"
import { PreviewFrame, ResourceImage } from "./SceneResources"
import { SceneWindowControls } from "./SceneWindowControls"
import { publishSceneImage, releaseSceneImages } from "./lib/sceneResources"
import { MistakeLayout } from "./MistakeLayout"
import { createReviewDetailCache } from "./lib/reviewDetailCache"
import { createMorph } from "morphicons/dom"
import { Check, Star, X, Wrench, Plus, ChevronDown, FileQuestion, FileCheck, Trash2, ChevronUp, ListFilter, RefreshCw } from "lucide"
import { clearLegacyFavoriteTitles, readLegacyFavoriteTitles } from "./preview-favorites"
import { SFTileIcon, SF_TONE_COLORS } from "./sf"

const levelNames = ["不会", "不熟", "掌握"]
const FsrsReview = React.lazy(() => import("./FsrsReview"))
const FsrsSettings = React.lazy(() => import("./FsrsReview").then(module => ({ default: module.FsrsSettings })))
const cardColorSwatches = [
  "#f8d65c", "#f5a65b", "#ee7970", "#de76a2",
  "#ad83c5", "#7d91cc", "#6baed0", "#6dbeb3",
  "#83bd78", "#bad078", "#e7c577", "#d8a57d",
  "#b4a49b", "#a6b7bf", "#8f9db7", "#c6b9d5"
]
const levelExplanations = [
  "无法独立完成",
  "无法稳定完成",
  "稳定完成"
]
const levelReviewNotes = [
  "按 1、3、7 天逐步复测；保持“不会”时推进到下一档间隔。",
  "按 2、5、10 天复测，答题仍卡顿时继续巩固。",
  "14 天后再次确认；连续第二次掌握后结束自动复习。"
]
// 单一来源为 src/mistake-domain 的 REVIEW_CURVES（对象形态）；此处转成数组以兼容
// 下标遍历的既有组件（MistakeLevelGuide/DueReviewList）。
const defaultReviewCurves = [REVIEW_CURVES[0], REVIEW_CURVES[1], REVIEW_CURVES[2]]

if (typeof document !== "undefined") installWebUiColors(document.documentElement.style)

function levelLabel(level) {
  return levelNames[level] || levelNames[0]
}

const morphPaths = {
  toggleOff: "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7Zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  toggleOn: "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7Zm10 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  eyeOff: "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A11 11 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2 3.2M6.6 6.6C3.7 8.4 2 12 2 12s3.5 8 10 8a10 10 0 0 0 4.2-.9",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
  collapse: "M6 15l6-6 6 6",
  expand: "M6 9l6 6 6-6",
  checkbox: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  checkboxChecked: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 12l3 3 5-6",
}

// 图标形变统一走 Morphicons 官方引擎（createMorph，弹簧物理几何插值）。
// 规范见 AGENTS.md：禁止手写 CSS 交叉淡化/变换模拟；预设只用 smooth/snappy/bouncy。
function MorphIcon({ from, to, active = false, className = "" }) {
  const pathRef = useRef(null)
  const engineRef = useRef(null)
  const fromData = morphPaths[from]
  const toData = morphPaths[to || from]
  useLayoutEffect(() => {
    const engine = createMorph(pathRef.current, active ? toData : fromData, { reducedMotion: "user" })
    engineRef.current = engine
    return () => { engine.destroy(); engineRef.current = null }
  }, [fromData, toData])
  useLayoutEffect(() => {
    engineRef.current?.morphTo(active ? toData : fromData, "snappy")
  }, [active, fromData, toData])
  return <svg className={`morphIcon ${active ? "is-active" : ""} ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path ref={pathRef} /></svg>
}

// 详情控件与定位/收藏共用 Morphicons，IconNode 直接来自 Lucide。
function DetailMorphIcon({ icon, active = false, target = Check }) {
  const path = useRef(null)
  const engine = useRef(null)
  useLayoutEffect(() => {
    engine.current = createMorph(path.current, active ? target : icon, { reducedMotion: "user" })
    return () => { engine.current?.destroy(); engine.current = null }
  }, [icon, target])
  useLayoutEffect(() => { engine.current?.morphTo(active ? target : icon, "snappy") }, [active, icon, target])
  return <svg className="detailMorphIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path ref={path} /></svg>
}

function AnimatedCheckbox({ checked, onChange, label, className = "" }) {
  return <span className={`svgCheckbox ${className}`} onClick={event => event.stopPropagation()}>
    <input type="checkbox" checked={checked} aria-label={label} onChange={onChange} />
    <MorphIcon from="checkbox" to="checkboxChecked" active={checked} />
  </span>
}

function SvgSwitch({ checked, label }) {
  return <span className="svgSwitch" data-checked={checked ? "true" : "false"} role={label ? "switch" : undefined} aria-label={label} aria-checked={label ? checked : undefined} aria-hidden={label ? undefined : true}><MorphIcon from="toggleOff" to="toggleOn" active={checked} /></span>
}

// Morphicons 官网使用的 Lucide IconNode 数据：map-pin 点击后形变为 check。
// 直接把 IconNode 交给 createMorph，避免维护一份与图标库脱节的手绘路径。
const locateMapPinIcon = [
  ["path", { d: "M20 10c0 5-5.5 11.5-7.4 13.5a1 1 0 0 1-1.2 0C9.5 21.5 4 15 4 10a8 8 0 1 1 16 0" }],
  ["circle", { cx: 12, cy: 10, r: 3 }]
]
const locateCheckIcon = [["path", { d: "M5 12l4 4L19 6" }]]
// React 首帧在 Morphicons 接管前使用的等价复合路径。
const locateMapPinInitialPath = "M20 10c0 5-5.5 11.5-7.4 13.5a1 1 0 0 1-1.2 0C9.5 21.5 4 15 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0"
// 收藏图标与 Morphicons 官网示例一致：直接消费 vanilla lucide 的 IconNode 数据。
const favoriteStarInitialPath = Star.map(([, attributes]) => attributes.d || "").join("")

// 每个定位入口独立记录点击时间。跳转原题后面板可能重载，但不能让一题的
// 点击把同页所有定位按钮一起变成对号。
const LOCATE_REVERT_MS = 2200
const LOCATE_TIMES_KEY = "mn-locate-times"
const locateTimes = (() => {
  try {
    const value = JSON.parse(sessionStorage.getItem(LOCATE_TIMES_KEY) || "{}")
    return new Map(Object.entries(value).map(([key, at]) => [key, Number(at) || 0]))
  } catch (_) { return new Map() }
})()
function saveLocateTimes() {
  try { sessionStorage.setItem(LOCATE_TIMES_KEY, JSON.stringify(Object.fromEntries(locateTimes))) } catch (_) {}
}

// 已挂载定位按钮的续期回调：面板重显/数据刷新时统一重算对号态与还原倒计时
const locateResyncCallbacks = new Set()
function touchLocateOnShow() {
  // 冻结/隐藏期间墙钟照走，窗口会被跳转吃掉：面板重新可见时若尚在窗口内（含
  // 1.5s 宽限），以当前时刻重新起算，保证用户回来能看到完整的"对号→还原"
  const now = Date.now()
  locateTimes.forEach((at, key) => {
    if (at && now - at < LOCATE_REVERT_MS + 1500) locateTimes.set(key, now)
    else if (!at || now - at >= LOCATE_REVERT_MS + 1500) locateTimes.delete(key)
  })
  saveLocateTimes()
  locateResyncCallbacks.forEach(fn => { try { fn() } catch (_) {} })
}

// 定位原题按钮：map-pin → check 形变（Morphicons 弹簧动画），延迟后自动还原。
function LocateButton({ locateKey, className = "", onLocate, onWaiting, children, settingsIcon = false, ariaLabel }) {
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const pathRef = useRef(null)
  const morphRef = useRef(null)
  const revertRef = useRef(0)
  // useLayoutEffect：绘制前同步建引擎并续期对号态。useEffect 会在绘制后执行，
  // 重挂帧先画出一帧 map-pin 图标——正是"对勾闪一下"的那一帧。
  useLayoutEffect(() => {
    const morph = createMorph(pathRef.current, locateMapPinIcon, { reducedMotion: "user" })
    morphRef.current = morph
    const stateRef = { showing: "map-pin" }
    const apply = () => {
      clearTimeout(revertRef.current)
      const locatedAt = locateTimes.get(locateKey) || 0
      const since = Date.now() - locatedAt
      if (locatedAt && since >= 0 && since < LOCATE_REVERT_MS) {
        setActive(true)
        morph.set(locateCheckIcon)
        stateRef.showing = "check"
        revertRef.current = setTimeout(() => {
          if (!morphRef.current) return
          morphRef.current.morphTo(locateMapPinIcon, "smooth")
          setActive(false)
          stateRef.showing = "map-pin"
        }, LOCATE_REVERT_MS - since)
      } else if (stateRef.showing === "check") {
        setActive(false)
        morph.morphTo(locateMapPinIcon, "smooth")
        stateRef.showing = "map-pin"
      }
    }
    apply()
    locateResyncCallbacks.add(apply)
    return () => {
      locateResyncCallbacks.delete(apply)
      clearTimeout(revertRef.current)
      if (morphRef.current) { morphRef.current.destroy(); morphRef.current = null }
    }
  }, [locateKey])
  async function locate() {
    if (busy) return
    setBusy(true)
    const waitingTimer = setTimeout(() => onWaiting?.(), 450)
    try {
      const result = await onLocate()
      if (result?.locateHint) return
      const morph = morphRef.current
      if (morph) {
        clearTimeout(revertRef.current)
        locateTimes.set(locateKey, Date.now())
        saveLocateTimes()
        morph.morphTo(locateCheckIcon, "snappy")
        setActive(true)
        revertRef.current = setTimeout(() => { morphRef.current?.morphTo(locateMapPinIcon, "smooth"); setActive(false) }, LOCATE_REVERT_MS)
      }
    } finally {
      clearTimeout(waitingTimer)
      setBusy(false)
    }
  }
  return <button className={`${className} ${active ? "active" : ""}`} aria-label={ariaLabel} aria-busy={busy} disabled={busy} onClick={locate}>
    {settingsIcon
      ? <i className="locateSettingsIcon"><svg className="preview-target-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path ref={pathRef} d={locateMapPinInitialPath} /></svg></i>
      : <svg className="preview-target-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path ref={pathRef} d={locateMapPinInitialPath} /></svg>}
    {children}
  </button>
}

function FavoriteButton({ favorite, busy, onToggle }) {
  const pathRef = useRef(null)
  const morphRef = useRef(null)
  const [phase, setPhase] = useState("")
  useLayoutEffect(() => {
    const morph = createMorph(pathRef.current, Star, { reducedMotion: "user" })
    morphRef.current = morph
    return () => {
      morph.destroy()
      morphRef.current = null
    }
  }, [])
  async function toggle() {
    if (busy || phase) return
    const morph = morphRef.current
    const nextPhase = favorite ? "phaseCancel" : "phaseConfirm"
    setPhase(nextPhase)
    morph?.morphTo(favorite ? X : Check, "snappy")
    try {
      // 沿用旧版 Morphicons 时序：取消收藏 480ms 后平滑回星星；
      // 收藏先停留在对号 520ms，再用 bouncy 回到实心星星。
      const persist = onToggle()
      await new Promise(resolve => setTimeout(resolve, favorite ? 480 : 520))
      await persist
      morph?.morphTo(Star, favorite ? "smooth" : "bouncy")
    } finally {
      setPhase("")
    }
  }
  return <button type="button" className={`previewFavoriteButton ${favorite ? "favorited" : ""} ${phase}`} aria-pressed={favorite} aria-label={favorite ? "取消收藏" : "收藏错题"} title={favorite ? "取消收藏" : "收藏错题"} disabled={busy} onClick={toggle}>
    <svg className="previewFavoriteButtonIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path ref={pathRef} d={favoriteStarInitialPath} /></svg>
  </button>
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase()
    .replace(/[\s，,。.;；:：、/\\|()[\]【】{}]+/g, "")
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未知"
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function dayStartOf(ts) {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function reviewCountdown(value) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return "复习时间未知"
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (time < dayStart) return "已到期"
  if (time < dayStart + 86400000) return "今天到期"
  return `下次复习剩余 ${Math.round((time - dayStart) / 86400000)} 天`
}

function compactReviewStatus(item) {
  if (item.reviewCompleted) return "已结束"
  const text = reviewCountdown(item.nextReviewAt)
  if (text === "已到期") return "已逾期"
  if (text === "今天到期") return "今天复习"
  if (text === "复习时间未知") return "未知"
  return text.replace(/^下次复习剩余\s*/, "")
}

function categoryChoices(records, prefix) {
  const depth = prefix.length
  const counts = new Map()
  for (const record of records) {
    const path = record.categoryPath || []
    if (!prefix.every((part, index) => path[index] === part)) continue
    const part = path[depth]
    if (part) counts.set(part, (counts.get(part) || 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count }))
}

function manualTagsOf(record) {
  const raw = Array.isArray(record.manualCategories) && record.manualCategories.length
    ? record.manualCategories
    : record.manualCategory ? [record.manualCategory] : []
  return raw.filter(tag => !isManagedMistakeTag(tag))
}

function recordsRevision(records) {
  let hash = 2166136261
  const sorted = [...records].sort((a, b) => String(a.recordId).localeCompare(String(b.recordId)))
  for (const record of sorted) {
    const text = `${record.recordId}\u001f${record.updatedAt || ""}\u001e`
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `${sorted.length}:${(hash >>> 0).toString(36)}`
}

function patchReviewedMistake(data, reviewed) {
  if (!data?.mistakes?.records || !reviewed?.recordId) return data
  const records = data.mistakes.records.map(record =>
    record.recordId === reviewed.recordId ? { ...record, ...reviewed } : record
  )
  const now = Date.now()
  const today = new Date()
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const endToday = startToday + 86400000
  return {
    ...data,
    mistakes: {
      ...data.mistakes,
      records,
      revision: recordsRevision(records),
      dueCount: records.filter(record =>
        record.noteAvailable && !record.reviewCompleted && new Date(record.nextReviewAt).getTime() <= now
      ).length,
      todayDueCount: records.filter(record => {
        const dueAt = new Date(record.nextReviewAt).getTime()
        return record.noteAvailable && !record.reviewCompleted && dueAt >= startToday && dueAt < endToday
      }).length,
      levelCounts: levelNames.map((_, nextLevel) =>
        records.filter(record => record.level === nextLevel).length
      )
    }
  }
}

function mergeMistakePage(data, page) {
  const existing = data?.mistakes?.records || []
  const known = new Set(existing.map(record => record.recordId))
  const appended = (page?.records || []).filter(record => !known.has(record.recordId))
  return {
    ...data,
    mistakes: {
      ...data?.mistakes,
      ...page,
      records: [...existing, ...appended],
      // 分页完结时必须显式清掉上一页遗留的 nextOffset（JSON 序列化会丢 undefined 键，
      // 仅靠展开会让完结页残留上一页的续传游标）。
      nextOffset: page?.recordsComplete === true ? undefined : page?.nextOffset,
      recordsComplete: page?.recordsComplete === true
    }
  }
}

function waitForPaint() {
  // 隐藏 WebView 的 rAF 可能暂停，续传不能无限等待。
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 50)
    requestAnimationFrame(() => { clearTimeout(timer); resolve() })
  })
}

const DASHBOARD_SHELL_CACHE_KEY = "mn-dashboard-shell-v233"
function readDashboardShellCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(DASHBOARD_SHELL_CACHE_KEY) || "null")
    return cached?.mistakes?.records?.length || cached?.mistakes?.totalCount === 0 ? cached : null
  } catch { return null }
}
function saveDashboardShellCache(data) {
  try {
    localStorage.setItem(DASHBOARD_SHELL_CACHE_KEY, JSON.stringify(data))
  } catch { /* 缓存不可用时继续走原生分页 */ }
}

function MistakeRefreshConsent({ onAccept, onCancel }) {
  const [seconds, setSeconds] = useState(10)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(value => {
      if (value <= 1) {
        window.clearInterval(timer)
        return 0
      }
      return value - 1
    }), 1000)
    return () => window.clearInterval(timer)
  }, [])

  async function accept() {
    if (seconds > 0 || accepting) return
    setAccepting(true)
    await onAccept()
    setAccepting(false)
  }

  return <div className="migrationConsentBackdrop" role="presentation">
    <section className="migrationConsentDialog" role="dialog" aria-modal="true" aria-labelledby="migrationConsentTitle">
      <h2 id="migrationConsentTitle">迁移提示</h2>
      <p>为了简化复习流程和等级划分，现版本已将错题等级整合为三档。点击接受后，将从原六档错题按对应关系迁入新三档错题，此次迁移操作不可逆。新旧错题等级对应关系如下：</p>
      <dl>
        <div><dt>0–1级</dt><dd><span>→</span><em className="level level0">不会</em></dd></div>
        <div><dt>2–3级</dt><dd><span>→</span><em className="level level1">不熟</em></dd></div>
        <div><dt>4–5级</dt><dd><span>→</span><em className="level level2">掌握</em></dd></div>
      </dl>
      <p className="migrationConsentNote">旧标签将统一迁移：#错题、#错题0级、#错题1级改为 #错题_不会；2–3级改为 #错题_不熟；4–5级改为 #错题_掌握。无托管标签或位于纯答案的旧记录会先归档历史再移出列表；普通自定义标签保持不变。标签暂时不可读时会保留记录，稍后可重新刷新。</p>
      <footer>
        <button type="button" className="migrationCancel" onClick={onCancel} disabled={accepting}>取消</button>
        <button type="button" className="migrationAccept" onClick={accept} disabled={seconds > 0 || accepting}>
          {accepting ? "正在刷新…" : seconds > 0 ? `接受刷新（${seconds} 秒）` : "接受并刷新"}
        </button>
      </footer>
    </section>
  </div>
}

const WORKBENCH_PREFERENCE_PREFIX = "cardlink.workbench.preferences.v1."
const REVIEW_ORDERS = ["reviewed", "map", "added", "level", "remaining"]
const REVIEW_STATES = ["today", "overdue", "upcoming", "completed"]
const EMPTY_WORKBENCH_RECORDS = []

function useWorkbenchPreference(key, fallback, values, isSet = false) {
  const storageKey = WORKBENCH_PREFERENCE_PREFIX + key
  const [value, setValue] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey))
      if (isSet) return Array.isArray(stored) ? new Set(stored) : fallback
      if (values) return values.includes(stored) ? stored : fallback
      if (fallback === null || Array.isArray(fallback)) return Array.isArray(stored) ? stored : fallback
      return typeof stored === typeof fallback && stored !== null ? stored : fallback
    } catch { return fallback }
  })
  const current = useRef(value)
  function update(nextValue) {
    const next = typeof nextValue === "function" ? nextValue(current.current) : nextValue
    current.current = next
    setValue(next)
    try { localStorage.setItem(storageKey, JSON.stringify(isSet && next ? [...next] : next)) }
    catch { /* active view still keeps the value */ }
  }
  return [value, update]
}

function App() {
  const mainRef = useRef(null)
  const answerInkReminderRef = useRef(null)
  const updatePromptRef = useRef(null)
  const [updatePrompt, setUpdatePrompt] = useState(null)
  const [answerInkSaving, setAnswerInkSaving] = useState(false)
  const startupSnapshotRef = useRef(readDashboardShellCache())
  const [tab, setTab] = useState("mistakes")
  const [data, setData] = useState(startupSnapshotRef.current)
  const answerInkEnabled = data?.matching?.answerInkEnabled === true
  function answerUpdateChoice(choice) {
    // 身份随选择回传：原生据此只结束同一条提示，旧弹窗无法确认新提示。
    const promptId = updatePrompt?.promptId
    setUpdatePrompt(null)
    MNBridge.send("updateChoice", { choice, promptId }).catch(() => {})
  }
  // 原生可能在我们注册 window.__cardLinkUpdatePrompt 之前就已排好更新提示，
  // 所以面板启动与重新显示时主动拉一次，避免退化成原生弹窗。
  async function pullPendingUpdatePrompt() {
    try {
      const pending = await MNBridge.send("pendingUpdatePrompt")
      if (pending && pending.version) setUpdatePrompt(pending)
    } catch { /* 没有待处理提示或桥不可用时忽略 */ }
  }
  useEffect(() => {
    const dialog = updatePromptRef.current
    if (!dialog) return
    if (updatePrompt && !dialog.open) dialog.showModal()
    if (!updatePrompt && dialog.open) dialog.close()
  }, [updatePrompt])
  async function setAnswerInkEnabled(value) {
    setAnswerInkSaving(true)
    try { await action("setPersonalSetting", { key: "answerInkEnabled", value }) }
    finally { setAnswerInkSaving(false) }
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [searchScopes, setSearchScopes] = useWorkbenchPreference("search.scopes", ["title", "tags", "content"])
  const searchContent = searchScopes.includes("content")
  const [contentSearchRevision, refreshContentSearch] = React.useReducer(value => value + 1, 0)
  const [ocrPulse, requestOCRWork] = React.useReducer(value => value + 1, 0)
  const [ocrQueueActive, setOCRQueueActive] = useState(false)
  const [ocrAutomaticRunning, setOCRAutomaticRunning] = useState(false)
  function didRefreshOCR(result) {
    if (result.changed) {
      refreshContentSearch()
      requestOCRWork()
    }
  }
  const [contentSearch, setContentSearch] = useState({ query: "", ids: [], pending: false, error: "" })
  useEffect(() => {
    let cancelled = false
    if (tab !== "mistakes" || !query.trim() || !searchContent) {
      setContentSearch({ query, ids: [], pending: false, error: "" })
      return
    }
    setContentSearch(current => ({ query, ids: current.query === query ? current.ids : [], pending: true, error: "" }))
    const timer = setTimeout(async () => {
      try {
        const result = await MNBridge.send("ocrDbSearchContent", { query })
        if (!cancelled) setContentSearch({ query, ids: result.recordIds, pending: false, error: "" })
      } catch (error) {
        if (!cancelled) setContentSearch({ query, ids: [], pending: false, error: "内容搜索失败，请重新输入重试" })
      }
    }, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, searchContent, contentSearchRevision, tab])
  const [dateFilter, setDateFilter] = useWorkbenchPreference("mistakes.date", "all", ["all", "today", "7", "30"])
  const [favoritesOnly, setFavoritesOnly] = useWorkbenchPreference("mistakes.favorites", false)
  const [level, setLevel] = useWorkbenchPreference("mistakes.level", "all")
  const [categoryPath, setCategoryPath] = useWorkbenchPreference("mistakes.category", [])
  const [selectedId, setSelectedId] = useState("")
  const [listLocation, setListLocation] = useState(null)
  const [detail, setDetail] = useState(null)
  const [exportRecordIds, setExportRecordIds] = useState([])
  const [exportReturnTab, setExportReturnTab] = useState("settings")
  const [locateHint, setLocateHint] = useState("")
  const locateHintTimerRef = useRef(0)
  const [pendingNotice, setPendingNotice] = useState("")
  const [reviewFocusId, setReviewFocusId] = useState("")
  const [settingsPane, setSettingsPane] = useState("root")
  const [settingsSection, setSettingsSection] = useState("answer")
  const [maskSettingsOpen, setMaskSettingsOpen] = useState(false)
  const [clipSettingsOpen, setClipSettingsOpen] = useState(false)
  const topNavRef = useRef(null)
  const [topNavSlider, setTopNavSlider] = useState(null)
  const [streamLoading, setStreamLoading] = useState(false)
  const selectedIdRef = useRef("")
  const detailSeqRef = useRef(0)
  const dataRef = useRef(null)
  const loadSeqRef = useRef(0)
  const activeLoadRef = useRef(null)
  const queuedLoadRef = useRef(null)
  const initialLoadCompleteRef = useRef(false)
  const versionTapRef = useRef({ count: 0, lastAt: 0 })
  selectedIdRef.current = selectedId
  dataRef.current = data


  async function performLoad(quiet = false) {
    const seq = ++loadSeqRef.current
    // 整页刷新会让列表先缩回首页 25 条、滚动被钳制；记下旧滚动位置，
    // 分页续传完成后恢复（与改标签就地补丁同一目标的双保险）。
    const listScrollSurface = document.querySelector(".mistakeSidebar")
    const previousListScroll = listScrollSurface?.scrollTop ?? 0
    let firstPagePublished = false
    if (!quiet) {
      setBusy(true)
      setError("")
    }
    try {
      let next = await MNBridge.send("dashboard")
      const legacyFavoriteTitles = readLegacyFavoriteTitles()
      if (legacyFavoriteTitles.length) {
        const migrated = await MNBridge.send("migrateLegacyFavorites", { titles: legacyFavoriteTitles })
        if (migrated) {
          clearLegacyFavoriteTitles()
          next = await MNBridge.send("dashboard")
        }
      }
      // 请求序号防旧覆盖新：面板快速显隐/连续操作时丢弃过期快照。
      if (seq !== loadSeqRef.current) return
      // 后台刷新保留当前完整列表，收齐分页再发布，避免列表缩短钳制滚动位置。
      if (!quiet) {
        setData(next)
        firstPagePublished = true
      }
      saveDashboardShellCache(next)
      if (!quiet) setBusy(false)
      if (next?.locateHint) showLocateHint(next.locateHint)
      // 首页落入 React 后先让浏览器完成一次绘制，再按同一原生快照逐页续传。
      // 这样数百道错题不会在启动时被序列化成一个巨型桥响应并阻塞白屏。
      await waitForPaint()
      setStreamLoading(true)
      while (next?.mistakes?.recordsComplete === false && Number.isFinite(next?.mistakes?.nextOffset)) {
        const page = await MNBridge.send("mistakesPage", {
          transferId: next.mistakes.transferId,
          offset: next.mistakes.nextOffset
        })
        if (seq !== loadSeqRef.current) return
        next = mergeMistakePage(next, page)
        if (!quiet) setData(next)
        await waitForPaint()
      }
      if (quiet) setData(next)
      // OCR search reads the index independently of detail and list row patches.
      refreshContentSearch()
      const records = next?.mistakes?.records || []
      if (!quiet && previousListScroll > 0) {
        // 等最后一次 setData 渲染完成后再恢复，两帧确保列表已按完整数据布局
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (listScrollSurface?.isConnected) listScrollSurface.scrollTop = previousListScroll
        }))
      }
      const currentSelectedId = selectedIdRef.current
      if (currentSelectedId && !records.some(item => item.recordId === currentSelectedId)) {
        detailSeqRef.current++
        selectedIdRef.current = ""
        setSelectedId("")
        setDetail(null)
      }
      else if (currentSelectedId && records.find(item => item.recordId === currentSelectedId)?.noteAvailable === false) {
        detailSeqRef.current++
        setDetail(null)
      }
      else if (currentSelectedId) {
        const detailSeq = detailSeqRef.current
        const detail = await MNBridge.send("mistakeDetail", { recordId: currentSelectedId, content: "question" })
        if (seq !== loadSeqRef.current || detailSeq !== detailSeqRef.current || selectedIdRef.current !== currentSelectedId) return
        setDetail(detail)
        setData(current => patchReviewedMistake(current, detail.record))
      }
    } catch (reason) {
      if (seq === loadSeqRef.current && (!quiet || firstPagePublished)) setError(reason.message || String(reason))
    } finally {
      // 续传中断（失败或被新请求取代）时必须撤下"正在载入"状态，横幅不得谎报加载仍在进行。
      setStreamLoading(false)
      if (!quiet) setBusy(false)
    }
  }

  // One dashboard snapshot owns one native transferId. Coalesce requests from
  // panel show, native changes and manual refresh instead of racing transfers.
  function load(quiet = false) {
    queuedLoadRef.current = queuedLoadRef.current === null ? quiet : queuedLoadRef.current && quiet
    if (activeLoadRef.current) return activeLoadRef.current
    activeLoadRef.current = (async () => {
      while (queuedLoadRef.current !== null) {
        const nextQuiet = queuedLoadRef.current
        queuedLoadRef.current = null
        await performLoad(nextQuiet)
      }
    })().finally(() => { activeLoadRef.current = null })
    return activeLoadRef.current
  }

  async function refreshBindingSettings() {
    const snapshot = await MNBridge.send("bindingSettingsSnapshot")
    setData(current => ({
      ...current,
      matching: { ...current?.matching, ...snapshot.matching },
      clipper: snapshot.clipper,
      answerBindings: snapshot.answerBindings
    }))
  }

  // 长耗时命令的等待提示：顶部进度线之外给出明确的转圈通知
  const PENDING_NOTICES = {
    repairMistakes: "正在刷新错题分类索引…",
    refreshAnswerIndex: "正在刷新答案索引…",
    checkUpdates: "正在检查插件更新…"
  }
  async function action(command, payload, reload = true) {
    const settingsOnly = ["chooseManagedAnswerMindMap", "updateManagedAnswerBinding", "addManagedAnswerBindingColor", "addGlobalAnswerBindingColor", "deleteManagedAnswerBinding", "bindAnswerNotebook", "chooseCurrentAnswerBinding", "unbindAnswerNotebook", "setScopedBinding", "configureAnswerMatching", "saveRegexMatchingRules", "setPersonalSetting", "setPanelCloseButtonSide"].includes(command)
    // 定位、关闭面板等无数据写入动作只由各自按钮反馈，不再遮住整页并制造
    // “重载所有错题”的假象。整页 busy 只属于真正会走 dashboard 的操作。
    if (reload && !settingsOnly) setBusy(true)
    const pendingText = PENDING_NOTICES[command]
    if (pendingText) setPendingNotice(pendingText)
    setError("")
    try {
      const result = await MNBridge.send(command, payload)
      if (command === "addManagedAnswerBindingColor" && result?.mismatch) return result
      if (["recordClipperTool", "setClipperTitle", "setClipperAnswer", "openClipperMode", "chooseClipperAnswerPosition", "configureClipperTitleFormat"].includes(command) && result) {
        setData(current => ({ ...current, clipper: result,
          matching: { ...current?.matching, ...(command === "openClipperMode" ? { pluginEnabled: false } : {}) } }))
        return result
      }
      if (reload && command === "reviewMistake" && result) {
        setData(current => ({ ...patchReviewedMistake(current, result), manualTodayIds: (current?.manualTodayIds || []).filter(id => id !== result.recordId) }))
        setBusy(false)
      }
      else if (reload && command === "changeMistakeLevel" && result?.recordId) {
        // 侧边改等级：用返回的记录就地更新队列，保证实时刷新，不依赖下一轮 dashboard。
        setData(current => ({ ...patchReviewedMistake(current, result), manualTodayIds: (current?.manualTodayIds || []).filter(id => id !== result.recordId) }))
        setBusy(false)
      }
      else if (reload && command === "changeMistakeLevels" && Array.isArray(result?.records)) {
        // 批量更改等级：逐条就地更新。
        setData(current => {
          const changedIds = new Set(result.records.map(record => record.recordId))
          const patched = result.records.reduce((data, record) => patchReviewedMistake(data, record), current)
          return { ...patched, manualTodayIds: (current?.manualTodayIds || []).filter(id => !changedIds.has(id)) }
        })
        setBusy(false)
      }
      else if (reload && command === "setMistakeCategory" && result?.recordId) {
        // 改自定义标签后就地更新记录与标签集合：整页刷新会重启分页快照（列表先缩回
        // 首页 25 条），滚动停留位置随之丢失。
        setData(current => {
          const patched = patchReviewedMistake(current, result)
          if (!patched?.mistakes) return patched
          const tags = Array.isArray(result.manualCategories) ? result.manualCategories.filter(Boolean) : []
          const customCategories = Array.from(new Set([...(patched.mistakes.customCategories || []), ...tags]))
            .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
          return { ...patched, mistakes: { ...patched.mistakes, customCategories } }
        })
        setDetail(current => current?.record?.recordId === result.recordId
          ? { ...current, record: { ...current.record, ...result } }
          : current)
        setBusy(false)
      }
      else if (reload && command === "setMistakeFavorite" && result?.recordId) {
        // 收藏切换同样就地更新，避免整页刷新挤走列表停留位置。
        setData(current => patchReviewedMistake(current, result))
        setDetail(current => current?.record?.recordId === result.recordId
          ? { ...current, record: { ...current.record, ...result } }
          : current)
        setBusy(false)
      }
      else if (command === "setPluginEnabled") {
        setData(current => ({ ...current, matching: { ...current?.matching, pluginEnabled: result.enabled } }))
        setBusy(false)
      }
      else if (command === "setReviewAlgorithm" && result) {
        setData(current => ({ ...current, reviewAlgorithm: result.algorithm }))
        setBusy(false)
      }
      else if (command === "setDebugMode" && result) {
        // 调试开关与 setPluginEnabled 同一数据流：直接以命令结果更新 matching，
        // 不再依赖整页 dashboard 重载，大错题库下开关不再被分页状态卡住。
        setData(current => ({ ...current, reviewAlgorithm: result.algorithm || "fixed", matching: { ...current?.matching, debugModeEnabled: result.enabled === true, debugAiAnalysisEnabled: result.enabled === true && current?.matching?.debugAiAnalysisEnabled === true, debugUpdateDownloadsEnabled: result.enabled === true && current?.matching?.debugUpdateDownloadsEnabled === true, debugAutoInstallUpdatesEnabled: result.enabled === true && current?.matching?.debugAutoInstallUpdatesEnabled === true } }))
        setBusy(false)
      }
      else if ((command === "setDebugUpdateDownloads" || command === "setDebugAutoInstallUpdates" || command === "chooseAnswerPreviewMode") && result) {
        setData(current => ({ ...current, matching: { ...current?.matching, ...result } }))
        setBusy(false)
      }
      else if (command === "chooseSourceLocateMode" && result) {
        setData(current => ({ ...current, matching: { ...current?.matching, sourceLocateMode: result.mode } }))
        setBusy(false)
      }
      else if ((command === "setPersonalSetting" || command === "chooseReviewCommentCount") && result) {
        setData(current => ({ ...current, matching: { ...current?.matching, ...result } }))
        if (command === "setPersonalSetting" && payload?.key === "boundHandwritingDisplay" && selectedId) await openDetail(selectedId)
      }
      else if (command === "setPanelCloseButtonSide" && result?.side) {
        setData(current => ({ ...current, matching: { ...current?.matching, panelCloseButtonSide: result.side } }))
      }
      else if (settingsOnly) await refreshBindingSettings()
      else if (command === "addManualTodayOverdue" && result) {
        setData(current => ({ ...current, manualTodayIds: result.ids }))
      }
      else if (reload) await load()
      else if (reload) setBusy(false)
      return result
    } catch (reason) {
      setError(reason.message || String(reason))
      if (reload && !settingsOnly) setBusy(false)
      // 操作失败（含写入回滚、记录被同步取消）也要刷新数据，让队列立刻反映真实状态。
      if (reload && !settingsOnly) await load(true)
      return undefined
    } finally {
      if (pendingText) setPendingNotice("")
    }
  }

  async function openDetail(recordId) {
    const seq = ++detailSeqRef.current
    selectedIdRef.current = recordId
    setSelectedId(recordId)
    setDetail(current => current?.record?.recordId === recordId ? current : null)
    setBusy(true)
    setError("")
    try {
      const nextDetail = await MNBridge.send("mistakeDetail", { recordId, content: "question" })
      if (seq !== detailSeqRef.current || selectedIdRef.current !== recordId) return
      setDetail(nextDetail)
      setData(current => patchReviewedMistake(current, nextDetail.record))
      void MNBridge.send("ocrDbRefreshSources", { recordId }).then(didRefreshOCR).catch(reason =>
        MNBridge.send("runtimeLog", { event: "ocr.refresh.failed", detail: String(reason.message || reason) }).catch(() => {}))
    } catch (reason) {
      if (seq !== detailSeqRef.current || selectedIdRef.current !== recordId) return
      setDetail(null)
      setError(reason.message || String(reason))
      await load(true)
    } finally {
      if (seq === detailSeqRef.current) setBusy(false)
    }
  }

  function openLinkedDetail(recordId) {
    setListLocation({ recordId })
    setTab("mistakes")
    if (recordId !== selectedIdRef.current) void openDetail(recordId)
  }

  function openListedDetail(recordId) {
    if (recordId !== selectedIdRef.current) setListLocation(null)
    void openDetail(recordId)
  }

  function openExport(recordIds = []) {
    setExportRecordIds(Array.isArray(recordIds) ? recordIds : [])
    setExportReturnTab(tab === "mistakes" ? "mistakes" : "settings")
    setTab("export")
    requestAnimationFrame(() => document.querySelector("main")?.scrollTo({ top: 0, left: 0 }))
  }

  useEffect(() => {
    // 数据启动不依赖隐藏 WebView 可能暂停的 rAF；仍只发一次初始请求。
    // effect发生在React已提交外壳之后，不能在createRoot.render返回时提前撤掉原生启动提示。
    let detail = `elapsedMs=${Date.now() - (window.__MN_BOOT_STARTED_AT__ || Date.now())}`
    if (!window.__MN_SCENE_ENABLED__) {
      const rootTop = document.getElementById("root")?.getBoundingClientRect().top
      detail += `; scrollY=${window.scrollY}; rootTop=${rootTop}; visualViewportOffsetTop=${window.visualViewport?.offsetTop}`
    }
    MNBridge.send("runtimeLog", { event: "boot.appRendered", detail }).catch(() => {})
    const openLinkedLocation = () => {
      const recordId = new URLSearchParams(window.location.hash.slice(1)).get("mistake")
      if (recordId) openLinkedDetail(recordId)
    }
    window.addEventListener("hashchange", openLinkedLocation)
    const initialTimer = window.setTimeout(() => {
          void (async () => {
            await load(Boolean(startupSnapshotRef.current))
            initialLoadCompleteRef.current = true
            void pullPendingUpdatePrompt()
            openLinkedLocation()
          })()
        }, 0)
    window.__onPanelShow = async options => {
      window.dispatchEvent(new Event('cardlink-panel-show'))
      void pullPendingUpdatePrompt()
      if (dataRef.current?.matching?.debugModeEnabled && dataRef.current?.reviewAlgorithm === "fsrs") window.dispatchEvent(new Event("cardlink-fsrs-refresh"))
      touchLocateOnShow()
      // Clipper lifecycle changes do not change the mistake index revision.
      // Refresh settings even when the existing list can stay on screen.
      try { await refreshBindingSettings() }
      catch (reason) { setError(reason.message || String(reason)) }
      // 跨学习集定位跳转后面板恢复时原生会携带 skipReload（true）：跳转不改变
      // 错题数据，跳过这次自动刷新可避免列表重建与滚动位置丢失。
      const skipReload = options === true || (options && options.skipReload === true)
      if (!skipReload && initialLoadCompleteRef.current) {
        try {
          const status = await MNBridge.send("mistakesRevision")
          if (status?.revision !== dataRef.current?.mistakes?.revision) load(true)
        } catch { /* keep the rendered snapshot when the lightweight probe fails */ }
      }
    }
    window.__onNativeDataChanged = () => {
      if (dataRef.current?.matching?.debugModeEnabled && dataRef.current?.reviewAlgorithm === "fsrs") window.dispatchEvent(new Event("cardlink-fsrs-refresh"))
      touchLocateOnShow(); load()
    }
    window.__cardLinkUpdatePrompt = payload => { setUpdatePrompt(current => normalizeUpdatePrompt(payload, current)) }
    window.__onNativeBindingsChanged = () => { void refreshBindingSettings().catch(reason => setError(reason.message || String(reason))) }
    return () => {
      window.removeEventListener("hashchange", openLinkedLocation)
      delete window.__onPanelShow
      delete window.__cardLinkUpdatePrompt
      delete window.__onNativeDataChanged
      delete window.__onNativeBindingsChanged
      clearTimeout(initialTimer)
      clearTimeout(locateHintTimerRef.current)
    }
  }, [])

  function showLocateHint(message) {
    setLocateHint(String(message || ""))
    clearTimeout(locateHintTimerRef.current)
    locateHintTimerRef.current = setTimeout(() => setLocateHint(""), 6000)
  }

  const [templateConverterOpen, setTemplateConverterOpen] = useState(false)
  const [cacheSettingsOpen, setCacheSettingsOpen] = useState(false)
  const debugModeEnabled = data?.matching?.debugModeEnabled === true
  const aiAnalysisEnabled = debugModeEnabled && data?.matching?.debugAiAnalysisEnabled === true
  useEffect(() => {
    if (aiAnalysisEnabled) return
    if (tab === "ai") setTab("mistakes")
    if (settingsPane === "ai") setSettingsPane("root")
  }, [aiAnalysisEnabled, settingsPane, tab])
  const [connectivityResult, setConnectivityResult] = useState(null)
  useEffect(() => {
    if (!debugModeEnabled) setConnectivityResult(null)
  }, [debugModeEnabled])
  async function runConnectivityTest() {
    setConnectivityResult(null)
    const result = await action("testTelemetryConnectivity", null, false)
    if (result?.test) setConnectivityResult(result)
  }

  async function handleVersionTap() {
    const now = Date.now()
    const taps = versionTapRef.current
    taps.count = now - taps.lastAt <= 1500 ? taps.count + 1 : 1
    taps.lastAt = now
    if (!debugModeEnabled && taps.count >= 5) {
      taps.count = 0
      setSettingsPane("root")
      await action("setDebugMode", { enabled: true })
      return
    }
    if (debugModeEnabled) {
      await action("notify", { message: `当前版本 v${data?.version || "…"}；调试模式已开启` }, false)
    }
  }

  async function refreshPanel() {
    await action("refreshMistakeList")
  }

  async function exportRuntimeLog() {
    setError("")
    try {
      await MNBridge.send("exportRuntimeLog")
    } catch (reason) {
      setError(reason.message || String(reason))
    }
  }

  const deferredQuery = React.useDeferredValue(query)
  const records = useMemo(() => {
    const needle = normalizeSearch(deferredQuery)
    const contentIds = new Set(contentSearch.query === deferredQuery ? contentSearch.ids : [])
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return (data?.mistakes?.records || []).filter(item => {
      if (level !== "all" && String(item.level) !== level) return false
      if (categoryPath.length && !categoryPath.every((part, index) => (item.categoryPath || [])[index] === part)) return false
      if (needle && !(searchScopes.includes("title") && normalizeSearch(item.sourceTitle).includes(needle)
        || searchScopes.includes("tags") && normalizeSearch(filterableMistakeTags(item).join(" ")).includes(needle)
        || searchScopes.includes("content") && contentIds.has(item.recordId))) return false
      // B4：日期与收藏筛选从预览层 DOM 隐藏迁入 React 状态（导出/总览同源可继承）
      if (dateFilter !== "all") {
        const added = new Date(item.createdAt).getTime()
        const days = (now.getTime() - dayStartOf(added)) / 86400000
        if (dateFilter === "today" && days >= 1) return false
        if (dateFilter === "7" && days >= 7) return false
        if (dateFilter === "30" && days >= 30) return false
      }
      if (favoritesOnly && item.favorite !== true) return false
      return true
    })
  }, [data, deferredQuery, level, categoryPath, dateFilter, favoritesOnly, searchScopes, contentSearch])

  const fsrsActive = debugModeEnabled && data?.reviewAlgorithm === "fsrs"
  const [fsrsDayCounts, setFsrsDayCounts] = useState(null)
  const fixedDayCounts = useMemo(() => reviewDayStatus(data?.mistakes?.records || [], data?.manualTodayIds).counts,
    [data?.mistakes?.records, data?.manualTodayIds, new Date().toDateString()])
  const dayCounts = fsrsActive ? fsrsDayCounts : fixedDayCounts

  const entries = [
    ["overview", "总览"],
    ["mistakes", "错题本", data?.mistakes?.totalCount ?? data?.mistakes?.records?.length ?? 0],
    ["review", "待复习", dayCounts?.today],
    ...(aiAnalysisEnabled ? [["ai", "AI 分析"]] : []),
    ["settings", "设置"]
  ]
  useLayoutEffect(() => {
    function measure() {
      const nav = topNavRef.current
      const active = nav?.querySelector('[data-tab="' + tab + '"]')
      if (nav && active) setTopNavSlider(current => current?.left === active.offsetLeft && current?.width === active.offsetWidth ? current : { left: active.offsetLeft, width: active.offsetWidth })
    }
    measure()
    const nav = topNavRef.current
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null
    if (nav) { observer?.observe(nav); nav.querySelectorAll("button").forEach(button => observer?.observe(button)) }
    window.addEventListener("resize", measure)
    return () => { window.removeEventListener("resize", measure); observer?.disconnect() }
  }, [tab, data?.mistakes?.totalCount, data?.mistakes?.todayDueCount])

  const panelCloseSide = data?.matching?.panelCloseButtonSide === "right" ? "right" : "left"
  const sceneSizeEnabled = window.__MN_SCENE_ENABLED__ === true
  const refreshButton = <button className="iconButton" aria-label="刷新错题列表" title="刷新错题列表" onClick={refreshPanel} disabled={busy}><Icon name="refresh" /></button>
  const resetButton = <button className="iconButton" aria-label="重置窗口" title={window.__MN_SCENE_ENABLED__ ? "恢复窗口默认大小" : "重置窗口位置与大小"} onClick={() => action("resetPanelFrame", null, false)}><Icon name="window" /></button>
  const closeButton = <button className="iconButton" aria-label={window.__MN_SCENE_ENABLED__ ? "收起插件窗口" : "关闭插件窗口"} title={window.__MN_SCENE_ENABLED__ ? "收起并保留当前题目，从浮球或插件工具栏恢复" : "关闭插件窗口"} onClick={() => action("closePanel", null, false)}><Icon name="close" /></button>
  async function uploadMaskImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const dataUri = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file)
      })
      const resource = window.__MN_SCENE_ENABLED__ ? await publishSceneImage(dataUri) : { url: dataUri }
      const image = new Image()
      try {
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = resource.url })
        const scale = Math.min(1, 512 / Math.max(image.width, image.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height)
        const value = canvas.toDataURL("image/jpeg", .72)
        if (value.length > 400000) throw new Error("图片过大，请换一张图片")
        await action("setPersonalSetting", { key: "answerMaskImage", value })
      } finally { if (resource.key) releaseSceneImages([resource.key]); event.target.value = "" }
    } catch (reason) { setError(reason.message || "图片读取失败") }
  }

  return <div className={`shell panelClose-${panelCloseSide} tab-${tab}`}>
    <main ref={mainRef} data-cardlink-scene={sceneSizeEnabled ? "true" : undefined}>
      <dialog ref={updatePromptRef} className="answerMatchingDialog updatePrompt" aria-labelledby="update-prompt-title"
        onClose={() => setUpdatePrompt(null)}
        onCancel={event => { event.preventDefault(); answerUpdateChoice("later") }}>
        <h2 id="update-prompt-title">CardLink {updatePrompt?.channel || "新版本"}{updatePrompt?.version ? ` v${updatePrompt.version}` : ""}</h2>
        {updatePrompt && <>
          <p>当前版本 v{updatePrompt.currentVersion} · 来源：{updatePrompt.source}</p>
          <UpdatePromptNotes prompt={updatePrompt} />
          <form method="dialog">
            <button type="submit" value="later" onClick={() => answerUpdateChoice("later")}>取消</button>
            <button type="submit" value="manual" onClick={() => answerUpdateChoice("manual")}>手动安装</button>
            <button type="submit" value="direct" autoFocus onClick={() => answerUpdateChoice("direct")}>直接安装</button>
          </form>
        </>}
      </dialog>
      <header className="topBar">
        <div className="topTools topTools-left">{panelCloseSide === "left" && <div className="windowControlCapsule">{closeButton}{resetButton}{refreshButton}</div>}</div>
        <nav className="topNav" ref={topNavRef}>{topNavSlider && <span className="topNavSlider" aria-hidden="true" style={{ width: topNavSlider.width, transform: `translateX(${topNavSlider.left}px)` }} />}{entries.map(([key, name, count]) => <button key={key} data-tab={key} className={tab === key ? "active" : ""} onClick={() => { setReviewFocusId(""); if (key !== "settings") setSettingsPane("root"); setTab(key) }}><strong>{name}</strong>{count > 0 && <b>{count}</b>}</button>)}</nav>
        <div className="topTools topTools-right">{panelCloseSide === "right" && <div className="windowControlCapsule">{refreshButton}{resetButton}{closeButton}</div>}</div>
      </header>
      {sceneSizeEnabled && <SceneWindowControls side={panelCloseSide} />}

      {locateHint && <div className="locateHintBanner" role="alert">{locateHint}</div>}
      {pendingNotice && <div className="pendingNotice" role="status"><i /><span>{pendingNotice}</span></div>}
      <div className="pageHeading"><h1>{tab === "overview" ? "错题总览" : tab === "mistakes" ? "错题浏览" : tab === "review" ? "到期复习" : tab === "export" ? "导出错题" : tab === "ai" ? "AI 分析" : settingsPane === "ocr" ? "错题 OCR 数据库" : settingsPane === "ai" ? "AI 分析设置" : "设置"}</h1><p>{tab === "overview" ? "掌握情况、到期复习和最近错题概览" : tab === "mistakes" ? "全部错题保留在原脑图中，可添加标签、核对答案并定位原题" : tab === "export" ? "从当前错题记录生成可另存的 PDF 或 Markdown 文件" : tab === "ai" ? "基于只读错题快照的 AI 问答与统计，回答带证据引用" : settingsPane === "ocr" ? "题干检索、识别任务与人工修订" : settingsPane === "ai" ? "AI 服务商、模型与密钥配置（密钥保存在本机 Harness 数据库，可随时清除）" : "跨脑图答案与错题工作台"}</p></div>
      {error && <div className="workbenchError" role="alert"><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError("")}>×</button></div>}
      {busy && <div className="loading"><i />正在读取 MarginNote 数据…</div>}
      {data?.mistakes?.recordsComplete === false && streamLoading && <div className="dataStreamStatus" role="status">正在载入错题 {data.mistakes.records.length}/{data.mistakes.totalCount}…</div>}

      {tab === "overview" && <MistakeOverview
        records={data?.mistakes?.records || []}
        dayCounts={dayCounts}
        onBrowse={() => setTab("mistakes")}
        onOpen={recordId => { setTab("mistakes"); openListedDetail(recordId) }}
        onSource={path => { setCategoryPath(path); setTab("mistakes") }}
        extra={aiAnalysisEnabled && <HarnessErrorBoundary><HarnessSyncCard
          onOpenAgent={() => setTab("ai")}
          onOpenSettings={() => { setTab("settings"); setSettingsPane("ai") }}
        /></HarnessErrorBoundary>}
      />}

      {tab === "mistakes" && <MistakeBrowser
        fsrsActive={debugModeEnabled && data?.reviewAlgorithm === "fsrs"}
        listDisplay={data?.matching?.mistakeListDisplay || "always"}
        records={records}
        allRecords={data?.mistakes?.records || []}
        categories={data?.mistakes?.categories || []}
        customCategories={data?.mistakes?.customCategories || []}
        query={query} setQuery={setQuery} searchScopes={searchScopes} setSearchScopes={setSearchScopes}
        level={level} setLevel={setLevel}
        categoryPath={categoryPath} setCategoryPath={setCategoryPath}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        favoritesOnly={favoritesOnly}
        setFavoritesOnly={setFavoritesOnly}
        selectedId={selectedId}
        detail={detail}
        openDetail={openListedDetail}
        listLocation={listLocation}
        openLinkedDetail={openLinkedDetail}
        action={action}
        reloadDetail={() => selectedId && openDetail(selectedId)}
        onRemoved={() => { setSelectedId(""); setDetail(null) }}
        onExportSelected={openExport}
        onReview={recordId => { setReviewFocusId(recordId); setTab("review") }}
        showLocateHint={showLocateHint}
      />}

      {fsrsActive && <React.Suspense fallback={tab === "review" && <p>正在载入复习记录…</p>}><FsrsReview onDayCounts={setFsrsDayCounts} recordsRevision={data?.mistakes?.revision} sources={data?.mistakes?.records || EMPTY_WORKBENCH_RECORDS}>{({ records, adapter }) => tab === "review" && <DueReviewList
        key="fsrs" records={records} adapter={adapter} action={action} manualTodayIds={adapter.manualTodayIds}
        handwritingAvailable={data?.features?.handwriting === true}
        focusRecordId={reviewFocusId} showLocateHint={showLocateHint} commentExpandCount={data?.matching?.reviewExpandedCommentCount ?? 2}
      />}</FsrsReview></React.Suspense>}
      {tab === "review" && !(debugModeEnabled && data?.reviewAlgorithm === "fsrs") && <DueReviewList
        handwritingAvailable={data?.features?.handwriting === true}

        onRecordChanged={record => setData(current => patchReviewedMistake(current, record))}
        focusRecordId={reviewFocusId}
        records={(data?.mistakes?.records || []).filter(item => item.noteAvailable)}
        reviewCurves={data?.mistakes?.reviewCurves}
        action={action}
        manualTodayIds={data?.manualTodayIds || []}
        showLocateHint={showLocateHint}
        commentExpandCount={data?.matching?.reviewExpandedCommentCount ?? 2}
      />}

      {tab === "export" && <MistakeExport
        allRecords={data?.mistakes?.records || []}
        action={action}
        initialRecordIds={exportRecordIds}
        onBack={() => setTab(exportReturnTab)}
      />}

      <OCRBackground pulse={ocrPulse} enabled={!ocrQueueActive} onIndexed={refreshContentSearch} onActive={setOCRAutomaticRunning} />
      {tab === 'settings' && settingsPane === 'ocr' && <OCRDatabase sourceRevision={contentSearchRevision} onQueueActive={setOCRQueueActive} automaticRunning={ocrAutomaticRunning} onIndexed={refreshContentSearch} onSourcesRefreshed={didRefreshOCR} Morph={DetailMorphIcon} Switch={SvgSwitch} Select={ExportSelect} onBack={() => { setSettingsPane('root'); setSettingsSection('mistakes') }} />}
        {aiAnalysisEnabled && tab === 'settings' && settingsPane === 'ai' && <HarnessErrorBoundary><HarnessSettings onBack={() => { setSettingsPane('root'); setSettingsSection('about') }} /></HarnessErrorBoundary>}
      {aiAnalysisEnabled && tab === "ai" && <HarnessErrorBoundary><AgentPanel onOpenSettings={() => { setTab("settings"); setSettingsPane("ai") }} /></HarnessErrorBoundary>}
      {tab === "settings" && settingsPane === "root" && <section className="settingsPage settingsPaged">
      <nav className="settingsCapsule" aria-label="设置分类">
        <span className="settingsCapsuleSlider" style={{ transform: `translateX(${["answer", "mistakes", "personal", "about"].indexOf(settingsSection) * 100}%)` }} />
        {[["answer", "答案配置"], ["mistakes", "错题管理"], ["personal", "个性设置"], ["about", "关于插件"]].map(([key, label]) =>
          <button type="button" key={key} className={settingsSection === key ? "active" : ""} aria-current={settingsSection === key ? "page" : undefined} onClick={() => setSettingsSection(key)}>{label}</button>)}
      </nav>
        {settingsSection === "answer" && <div className="settingsGroups">
          <SettingsGroup title="当前脑图" tone="accent" items={[
            ["link", "为当前脑图绑定答案", "选择答案脑图或直接子卡片", () => action("chooseCurrentAnswerBinding")],
            ["refresh", "刷新答案索引", "重建当前绑定的答案脑图索引", () => action("refreshAnswerIndex")],
            ["unlink", "解除答案绑定", "解除当前脑图的答案关联", () => action("unbindAnswerNotebook")]
          ]} />
          <SettingsGroup title="匹配规则" tone="accent" items={[
            ["sliders", "答案脑图匹配规则", data?.matching?.label || "完整标题匹配", () => action("configureAnswerMatching")],
            ["bind", "多题目脑图独立绑定", data?.matching?.scopedBinding ? "已开启" : "已关闭", () => action("setScopedBinding", { enabled: !data?.matching?.scopedBinding }), <SvgSwitch checked={!!data?.matching?.scopedBinding} label="多题目脑图独立绑定" key="scoped" />]
          ]} />
          {data?.matching?.mode === "regex" && <RegexMatchingSettings matching={data.matching} action={action} />}
          <AnswerBindingsManager rows={data?.answerBindings || []} colors={data?.matching?.globalQuestionColors || []} action={action} />
          <SettingsGroup title="摘题" tone="accent" items={[
            ["tools", "打开摘题模式", "快捷摘录题目与答案", () => action("openClipperMode", null, false)],
            ["sliders", "摘题设置", clipSettingsOpen ? "收起设置" : "工具绑定、答案位置与标题摘录", () => setClipSettingsOpen(value => !value)]
          ]}>{clipSettingsOpen && <ClipperSettings clipper={data?.clipper} action={action} />}</SettingsGroup>
        </div>}
        {settingsSection === "mistakes" && <div className="settingsGroups">
          <SettingsGroup title="错题管理" tone="amber" items={[
            ["flag", "批量标记所选错题", "将当前选中的脑图卡片标记为错题", () => action("markMistake")],
            ["refresh", "刷新错题索引", "重新读取错题分类及来源路径", () => action("repairMistakes")],
            ["download", "导出错题", "预览并导出 PDF 或 Markdown", openExport]
          ]} />
          {debugModeEnabled && data?.reviewAlgorithm === "fsrs" ? <React.Suspense fallback={<p>正在读取复习设置…</p>}><FsrsSettings Switch={SvgSwitch} /></React.Suspense> : <MistakeLevelGuide reviewCurves={data?.mistakes?.reviewCurves} action={action} />}
          <SettingsGroup title="其他错题工具" tone="amber" items={[
            ['book', '错题 OCR 数据库', '同步题干、全文搜索与识别任务', () => setSettingsPane('ocr')],
          ]} />
        </div>}
        {settingsSection === "personal" && <div className="settingsGroups">
          <SettingsGroup title="答题体验" tone="purple" items={[
            ["book", "子卡片答案展示", data?.matching?.subcardAnswerDisplay === "reveal" ? "解除当前题目子卡遮盖" : "弹出答案窗口", () => action("setPersonalSetting", { key: "subcardAnswerDisplay", value: data?.matching?.subcardAnswerDisplay === "reveal" ? "window" : "reveal" })],
            ["sliders", "答案遮盖设置", data?.matching?.maskImageConfigured ? "自定义图片" : "颜色遮盖", () => setMaskSettingsOpen(value => !value)]
          ]}>{maskSettingsOpen && <div className="answerMaskSettings"><strong>遮盖颜色</strong><div>{[["#141922", "深色"], ["#d9e4f2", "浅蓝"], ["#f6e7a5", "浅黄"], ["#d8f0d2", "浅绿"], ["#9c7cbb", "紫色"], ["#ce786f", "红色"]].map(([color, label]) => <button type="button" key={color} className={data?.matching?.answerMaskColor === color && !data?.matching?.maskImageConfigured ? "selected" : ""} onClick={() => action("setPersonalSetting", { key: "answerMaskColor", value: color })}><i style={{ background: color }} />{label}</button>)}</div><label className="answerMaskUpload">选择自定义图片<input type="file" accept="image/*" onChange={uploadMaskImage} /></label>{data?.matching?.maskImageConfigured && <button type="button" onClick={() => action("setPersonalSetting", { key: "answerMaskImage", value: "" })}>移除图片</button>}</div>}</SettingsGroup>

          <SettingsGroup title="操作与窗口" tone="purple" items={[
            ["toggle", "悬浮球默认展开模式", data?.matching?.entranceDefaultMode === "clipper" ? "摘题模式" : "做题模式", () => action("setPersonalSetting", { key: "entranceDefaultMode", value: data?.matching?.entranceDefaultMode === "clipper" ? "practice" : "clipper" })],
            ["handwriting", "答案预览手写批注", null, answerInkSaving ? undefined : () => answerInkEnabled ? setAnswerInkEnabled(false) : answerInkReminderRef.current.showModal(), <SvgSwitch checked={answerInkEnabled} />, answerInkEnabled],
            ["book", "卡片绑定手写显示", data?.matching?.boundHandwritingDisplay === "always" ? "始终显示" : "按需显示", () => action("setPersonalSetting", { key: "boundHandwritingDisplay", value: data?.matching?.boundHandwritingDisplay === "always" ? "doubleTap" : "always" })],
            ["sliders", "错题本列表显示方式", data?.matching?.mistakeListDisplay === "autoHide" ? "自动隐藏" : "始终显示", () => action("setPersonalSetting", { key: "mistakeListDisplay", value: data?.matching?.mistakeListDisplay === "autoHide" ? "always" : "autoHide" })],
            ["focusMode", "定位原题方式", ({ focus: "在脑图中定位并聚焦", float: "在浮窗中定位" }[data?.matching?.sourceLocateMode] || "在脑图中定位"), () => action("chooseSourceLocateMode", null, false)],
            ["toggle", "卡片侧边按钮", data?.matching?.pluginEnabled === false ? "已关闭" : "已开启", () => action("setPluginEnabled", { enabled: data?.matching?.pluginEnabled === false }), <SvgSwitch checked={data?.matching?.pluginEnabled !== false} label="卡片侧边按钮" key="side-button" />],
            ["arrowsLR", "插件窗口关闭按钮", panelCloseSide === "right" ? "右上角" : "左上角", () => action("setPanelCloseButtonSide", { side: panelCloseSide === "right" ? "left" : "right" }), <SvgSwitch checked={panelCloseSide === "right"} label="关闭按钮位于右侧" key="close-position" />]
          ]} />
          <dialog ref={answerInkReminderRef} className="answerMatchingDialog answerInkReminder" aria-labelledby="answer-ink-reminder-title">
            <h2 id="answer-ink-reminder-title">答案预览手写批注</h2>
            <p>此功能为插件内部实现的手写功能，与软件手写功能无关且不相通，开启后可在 CardLink 的答案预览中圈画标记。</p>
            <p>批注保存在本机，不会自动写入原卡评论。要修改笔迹，需回到 CardLink 的答案预览窗口。MarginNote 的手写工具无法编辑这些笔迹。</p>
            <p><strong>功能缺陷：</strong></p>
            <p>由于 iPad OS 的「随手写」功能会与批注书写功能冲突，从而可能会导致漏笔的情况。如果 Apple Pencil 落笔无反应，可到「设置 → Apple Pencil」关闭「随手写」。关闭后，系统的手写转文字也会停用。</p>
            <p><strong>请勿使用此功能记录重要笔记。</strong></p>
            <form method="dialog">
              <button type="submit" autoFocus>取消</button>
              <button type="submit" onClick={() => setAnswerInkEnabled(true)}>确认开启</button>
            </form>
          </dialog>
          <ReviewFeedbackSettings matching={data?.matching} action={action} />
        </div>}
        {settingsSection === "about" && <div className="settingsGroups">
          <SettingsGroup title="场景功能" tone="accent" items={[
            ["fileText", "模板转换", "上传自己的场景模板，转换为支持 CardLink 的模板并导出。", () => setTemplateConverterOpen(value => !value)]
          ]}>{templateConverterOpen && <TemplateConverter />}</SettingsGroup>
          <SettingsGroup title="关于插件" tone="green" items={[
            ["info", "当前版本", `v${data?.version || "…"} · frank`, handleVersionTap],
            ["reset", data?.features?.scenePanel ? "重置窗口大小" : "重置窗口位置", data?.features?.scenePanel ? "恢复插件窗口默认大小" : "恢复插件窗口默认位置与大小", () => action("resetPanelFrame", null, false)],
            ["guide", "插件使用说明", "查看 CardLink 使用说明", () => action("openPluginGuide", null, false)],
            ["update", "检查插件更新", "检查可用的新版本", () => action("checkUpdates", null, false)],
            ["cache", "缓存清理", cacheSettingsOpen ? "收起缓存清理" : "查看存储占用与清理本地缓存", () => setCacheSettingsOpen(value => !value)],
            ...(aiAnalysisEnabled ? [["book", "AI 分析设置", "服务商、模型与密钥（密钥本机持久化，可随时清除）", () => setSettingsPane("ai")]] : [])
          ]}>{cacheSettingsOpen && <LocalCacheSettings />}</SettingsGroup>
          {debugModeEnabled && <SettingsGroup title="调试功能" tone="red" items={[
            ["fileText", "导出运行日志", "导出调试模式期间的运行事件", exportRuntimeLog],
            ["close", "退出调试模式", "停止并清空运行日志", () => action("setDebugMode", { enabled: false })]
          ]} disclosure={{ title: "开发测试", icon: "tools", items: [
            ["toggle", "启用 AI 分析", "显示 AI 分析页签、总览快照和模型设置", () => action("setPersonalSetting", { key: "debugAiAnalysisEnabled", value: !aiAnalysisEnabled }), <SvgSwitch checked={aiAnalysisEnabled} label="启用 AI 分析" />],
            ["toggle", "FSRS 智能复习", "仅调试模式生效；两套进度独立保存，关闭后返回固定曲线", () => action("setReviewAlgorithm", { algorithm: data?.reviewAlgorithm === "fsrs" ? "fixed" : "fsrs" }), <SvgSwitch checked={data?.reviewAlgorithm === "fsrs"} label="FSRS 智能复习" />],
            ["toggle", "调试安装包下载", "启用后优先获取调试版本；退出调试模式后关闭", () => action("setDebugUpdateDownloads", { enabled: data?.matching?.debugUpdateDownloadsEnabled !== true }), <SvgSwitch checked={data?.matching?.debugUpdateDownloadsEnabled === true} label="调试安装包下载" />],
            ["toggle", "自动安装更新", "自动下载并安装，完成后请重启应用；退出调试模式后关闭", () => action("setDebugAutoInstallUpdates", { enabled: data?.matching?.debugAutoInstallUpdatesEnabled !== true }), <SvgSwitch checked={data?.matching?.debugAutoInstallUpdatesEnabled === true} label="自动安装更新" />],
            ["update", "查看更新状态", "对照当前运行版本与已安装版本", () => action("showUpdateStatus", null, false)],
            ["wifi", "联通测试", "检查上报通道", runConnectivityTest]
          ], content: connectivityResult && <ConnectivityResult result={connectivityResult} /> }} />}
        </div>}
      </section>}
    </main>
  </div>
}


// P1-7：顶栏高度以原生共享常量为准（拖拽热区与 CSS 同源）
if (typeof MNBridge !== "undefined" && MNBridge.send && !window.__MN_FULL_UI_PREVIEW__) {
  MNBridge.send("uiConstants").then(constants => {
    if (constants?.titleHeight) document.documentElement.style.setProperty("--mn-topbar-height", `${constants.titleHeight}px`)
  }).catch(() => { /* 取不到就用 CSS 回退值 */ })
}

function ConnectivityResult({ result }) {
  return <section className="connectivityResult"><header><strong>联通测试结果</strong><small>{formatDate(result.testedAt)} · 仅发送测试标记，不含笔记内容</small></header><div>{(result.results || []).map(item => <article key={item.key} className={item.reachable ? "reachable" : "failed"}><span><strong>{item.key}</strong><small>{item.reachable ? "通道正常" : (item.error || "无响应")}</small></span><b>{item.reachable ? `HTTP ${item.statusCode ?? "?"}` : "未连通"}<em>{item.durationMs} ms</em></b></article>)}</div></section>
}

function DateFilterButton({ value, onChange }) {
  const [open, setDateOpen] = useState(false)
  const ref = useRef(null)
  const menuRef = useRef(null)
  const popoverPos = useAnchoredPopover(open, ref, 110)
  useScrollDismiss(open, () => setDateOpen(false), menuRef)
  useEffect(function () {
    if (!open) return
    function close(e) {
      if (ref.current && !ref.current.contains(e.target) && !menuRef.current?.contains(e.target)) setDateOpen(false)
    }
    document.addEventListener("pointerdown", close, true)
    return function () { document.removeEventListener("pointerdown", close, true) }
  }, [open])
  var labels = { all: "全部时间", today: "今天", "7": "最近 7 天", "30": "最近 30 天" }
  return <span className="dateFilterWrap" ref={ref}>
    <button type="button" className={"dateFilterIcon" + (value !== "all" ? " active" : "")} aria-label="按添加日期筛选" title="按添加日期筛选" onClick={function () { setDateOpen(!open) }}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
    </button>
    {open && popoverPos && createPortal(<div className="datePopover" ref={menuRef} style={POPOVER_ABSOLUTE(popoverPos)}>
      {["all", "today", "7", "30"].map(function (key) {
        return <button type="button" key={key} className={value === key ? "active" : ""} onClick={function () { onChange(key); setDateOpen(false) }}>{labels[key]}</button>
      })}
    </div>, document.body)}
  </span>
}

function ReviewSortOptions({ value, onChange }) {
  return [["reviewed", "最后复习", "最近优先"], ["map", "脑图", "名称顺序"], ["added", "添加日期", "最新优先"], ["level", "等级", "由低到高"], ["remaining", "剩余天数", "由少到多"]].map(([key, label, hint]) => <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)}><span>{label}<small>{hint}</small></span><span aria-hidden="true">{value === key ? "✓" : ""}</span></button>)
}

function MistakeBrowser(props) {
  const { records: inputRecords, allRecords, selectedId, detail, openDetail, action, reloadDetail, onRemoved, onExportSelected } = props
  const [searchFocused, setSearchFocused] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [removeArmed, setRemoveArmed] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [sortOrder, setSortOrder] = useWorkbenchPreference("mistakes.order", "added", REVIEW_ORDERS)
  const [levels, setLevels] = useWorkbenchPreference("mistakes.levels", null)
  const [sources, setSources] = useWorkbenchPreference("mistakes.sources", null, null, true)
  const toolbarRef = useRef(null)
  const menuRef = useRef(null)
  const mistakeListRef = useRef(null)
  const lastListLocationRef = useRef(null)
  const visibleDetailRef = useRef(null)
  visibleDetailRef.current = { noteId: detail?.record?.sourceNoteId, reload: reloadDetail }
  const [dropFeedback, setDropFeedback] = useState(null)
  const sceneDrag = window.__MN_SCENE_ENABLED__ === true && !!window.mn
  const canDragCard = !selecting && !window.__MN_FULL_UI_PREVIEW__ &&
    (sceneDrag || window.location.protocol === "file:")
  useEffect(() => {
    if (!canDragCard || !mistakeListRef.current) return
    let current = true
    let request = 0
    const showResult = (result, sequence) => {
      const messages = {
        linked: "已建立双向链接",
        exists: "这两张卡片已有双向链接",
        sameNote: "请拖到另一张脑图卡片",
        miss: "请拖到当前学习集脑图中可见的卡片上",
        unavailable: "此窗口未接收到拖动手势，请重试",
      }
      const text = messages[result.status] || result.message
      if (current && sequence === request && text) {
        setDropFeedback({ text, error: result.status !== "linked" && result.status !== "exists" })
        const { noteId, reload } = visibleDetailRef.current
        if (result.status === "linked" && result.noteIds?.includes(noteId)) void reload()
      }
    }
    const failed = error => ({ status: "error", message: error?.message || "创建原题链接失败" })
    const uninstall = installMistakeCardDrag(mistakeListRef.current, {
      onLift(payload) {
        const sequence = ++request
        setDropFeedback(null)
        return MNBridge.send("armMistakeDrag", payload).catch(failed).then(result => {
          if (result.status !== "unavailable" || sceneDrag) showResult(result, sequence)
          return { result, sequence }
        })
      },
      async onDrop(payload, native) {
        if (sceneDrag || !native) return
        const { result, sequence } = await native
        if (result.status !== "unavailable" || !current || sequence !== request) return
        const fallback = await MNBridge.send("linkMistakeOnDrop", payload).catch(failed)
        showResult(fallback, sequence)
      },
      onCancel(id) { MNBridge.send("cancelMistakeDrag", { id }).catch(() => {}) },
    })
    return () => {
      current = false
      uninstall()
    }
  }, [canDragCard, sceneDrag])
  useEffect(() => {
    if (!dropFeedback) return
    const timeout = setTimeout(() => setDropFeedback(null), 4500)
    return () => clearTimeout(timeout)
  }, [dropFeedback])
  useEffect(() => {
    if (!searchFocused) return
    const dismiss = event => {
      if (event.type === "keydown" ? event.key === "Escape" : !toolbarRef.current?.contains(event.target)) setSearchFocused(false)
    }
    document.addEventListener("click", dismiss)
    document.addEventListener("keydown", dismiss)
    return () => { document.removeEventListener("click", dismiss); document.removeEventListener("keydown", dismiss) }
  }, [searchFocused])
  const menuWidth = Math.min(filtersOpen ? 350 : 210, typeof window !== "undefined" ? window.innerWidth - 36 : 350)
  const popoverPos = useAnchoredPopover(filtersOpen || sortOpen, toolbarRef, menuWidth, "end")
  useScrollDismiss(filtersOpen || sortOpen, () => { setFiltersOpen(false); setSortOpen(false) }, menuRef)
  useEffect(() => {
    if (!filtersOpen && !sortOpen) return
    const close = event => {
      if (event.type === "keydown" ? event.key === "Escape" : !toolbarRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setFiltersOpen(false); setSortOpen(false)
      }
    }
    document.addEventListener("pointerdown", close, true)
    document.addEventListener("keydown", close)
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", close) }
  }, [filtersOpen, sortOpen])
  const records = useMemo(() => sortReviewRecords(inputRecords.filter(item =>
    (levels === null || levels.includes(item.level)) && (sources === null || sources.has(item.recordId))), sortOrder), [inputRecords, levels, sources, sortOrder])
  const listLocation = props.listLocation?.recordId === selectedId ? props.listLocation : null
  const revealedRecord = listLocation && !records.some(item => item.recordId === selectedId)
    ? allRecords.find(item => item.recordId === selectedId) ?? detail?.record
    : null
  useLayoutEffect(() => {
    if (!listLocation || lastListLocationRef.current === listLocation) return
    const list = mistakeListRef.current
    const sidebar = list?.closest(".mistakeSidebar")
    const row = list?.querySelector(".mistakeItem.selected")
    if (!sidebar || !row) return
    const { top, bottom } = row.getBoundingClientRect()
    const sidebarTop = sidebar.getBoundingClientRect().top + sidebar.clientTop
    const visibleTop = Math.max(sidebarTop, toolbarRef.current?.getBoundingClientRect().bottom ?? sidebarTop)
    const visibleBottom = sidebarTop + sidebar.clientHeight
    if (top < visibleTop) sidebar.scrollTop += top - visibleTop
    else if (bottom > visibleBottom) sidebar.scrollTop += bottom - visibleBottom
    lastListLocationRef.current = listLocation
  }, [listLocation, records, revealedRecord])
  const filtered = levels !== null || sources !== null || props.favoritesOnly
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allVisibleSelected = records.length > 0 && records.every(record => selectedSet.has(record.recordId))
  useEffect(() => {
    const available = new Set(allRecords.map(record => record.recordId))
    setSelectedIds(current => current.filter(recordId => available.has(recordId)))
  }, [allRecords])

  function toggleSelecting() {
    setSelecting(value => !value)
    setSelectedIds([])
    setRemoveArmed(false)
  }

  function toggleRecord(recordId) {
    setRemoveArmed(false)
    setSelectedIds(current => current.includes(recordId)
      ? current.filter(id => id !== recordId)
      : [...current, recordId])
  }

  function toggleVisible() {
    setRemoveArmed(false)
    const visibleIds = new Set(records.map(record => record.recordId))
    setSelectedIds(current => allVisibleSelected
      ? current.filter(recordId => !visibleIds.has(recordId))
      : [...new Set([...current, ...visibleIds])])
  }

  async function changeSelectedLevel(nextLevel) {
    const result = await action("changeMistakeLevels", {
      recordIds: selectedIds,
      level: Number(nextLevel)
    })
    if (result) {
      setSelectedIds([])
      setRemoveArmed(false)
    }
  }

  async function removeSelected() {
    if (!removeArmed) return setRemoveArmed(true)
    const result = await action("removeMistakes", { recordIds: selectedIds })
    if (result) {
      setSelectedIds([])
      setRemoveArmed(false)
      onRemoved()
    }
  }

  return <section className="mistakeWorkspace">
    <MistakeLayout autoHide={props.listDisplay === "autoHide"} hasDetail={Boolean(detail?.record && detail.record.noteAvailable !== false)} revealList={listLocation}>
      <aside className="mistakeSidebar">
        <div ref={toolbarRef} className={`filterBar mistakeListHeader filtersClosed ${selecting ? "selectionOpen" : ""}`}>
          <div className="mistakeSearchGroup" onFocus={event => { if (event.target.tagName === "INPUT" || event.target.closest(".mistakeSearchScopes")) setSearchFocused(true) }}>
          <div className="mistakeSearchGlass">
          <div className="mistakeSearchCapsule"><Icon name="search" />
            <input aria-label="搜索错题" value={props.query} onChange={event => props.setQuery(event.target.value)} placeholder="搜索" onKeyDown={event => { if (event.key === "Escape") event.currentTarget.blur() }} />
            <button type="button" className={`reviewFilterToggle ${filtered || filtersOpen ? "active" : ""}`} aria-expanded={filtersOpen} aria-label="筛选" title="筛选" aria-controls="mistakeFilterPanel" onClick={() => { setFiltersOpen(value => !value); setSortOpen(false) }}><Icon name="filter" />{filtered && <span className="reviewFilterCount" aria-label={`筛选后 ${records.length} 道题`}>{records.length}</span>}</button>
            <button type="button" className={sortOpen ? "active" : ""} aria-expanded={sortOpen} aria-label="排序" title="排序" aria-controls="mistakeSortPanel" onClick={() => { setSortOpen(value => !value); setFiltersOpen(false) }}><Icon name="sort" /></button>
            <button className={`batchToggle svgIconButton ${selecting ? "active" : ""}`} aria-label={selecting ? "完成多选" : "进入多选"} title={selecting ? "完成多选" : "多选"} onClick={toggleSelecting}><MorphIcon from="checkbox" to="checkboxChecked" active={selecting} /></button>
          </div>
          {selecting && <div className="batchBar active">
          <button data-select-all-state={allVisibleSelected ? "all" : "none"} onClick={toggleVisible} disabled={!records.length}><MorphIcon from="checkbox" to="checkboxChecked" active={allVisibleSelected} /><span>{allVisibleSelected ? "全不选" : "全选"}</span></button>
          <span className="filterDivider" aria-hidden="true" />
          <select className="batchLevelSelect" title={props.fsrsActive ? "FSRS 反馈请在待复习中逐题提交" : undefined} aria-label="修改错题等级" defaultValue="" disabled={props.fsrsActive || !selectedIds.length} onChange={async event => { const value = event.target.value; if (value !== "") await changeSelectedLevel(Number(value)); event.target.value = "" }}><option value="">{props.fsrsActive ? "固定等级只读" : "修改等级"}</option>{levelNames.map((name, level) => <option key={name} value={level}>{name}</option>)}</select>
          <span className="filterDivider" aria-hidden="true" />
          <button className="batchExport" onClick={() => onExportSelected(selectedIds)} disabled={!selectedIds.length}>导出</button>
          <span className="filterDivider" aria-hidden="true" />
          <button className={`batchRemove ${removeArmed ? "confirming" : ""}`} onClick={removeSelected} disabled={!selectedIds.length}>{removeArmed ? `确认取消 ${selectedIds.length} 道` : "取消错题"}</button>
          </div>}
          </div>
          {(searchFocused || props.query) && <div className="mistakeSearchScopes" role="group" aria-label="搜索范围">
            {[["title", "标题"], ["tags", "标签"], ["content", "内容"]].map(([key, label]) => <button key={key} type="button" aria-pressed={props.searchScopes.includes(key)} onClick={() => props.setSearchScopes(current => current.includes(key) ? current.filter(scope => scope !== key) : [...current, key])}>{label}</button>)}
          </div>}
          </div>
          {(filtersOpen || sortOpen) && popoverPos && createPortal(<div ref={menuRef} className="reviewToolbar mistakeQueuePopover" style={{ ...POPOVER_ABSOLUTE(popoverPos), width: menuWidth }}>
            {filtersOpen ? <div id="mistakeFilterPanel" className="reviewFilterDropdown"><ReviewQueueFilters favoritesOnly={props.favoritesOnly} onFavoritesToggle={() => props.setFavoritesOnly(!props.favoritesOnly)} records={allRecords} names={levelNames.map((name, level) => [level, name])} levels={levels} setLevels={setLevels} selected={sources} setSelected={setSources} onReset={() => { setLevels(null); setSources(null); props.setLevel("all"); props.setCategoryPath([]); props.setDateFilter("all"); props.setFavoritesOnly(false) }} /></div>
              : <div id="mistakeSortPanel" className="reviewSortDropdown" role="group" aria-label="排序方式"><ReviewSortOptions value={sortOrder} onChange={value => { setSortOrder(value); setSortOpen(false) }} /></div>}
          </div>, document.body)}
          <AcrylicSurface />
        </div>
        {dropFeedback && <div className="mistakeDropFeedback" role={dropFeedback.error ? "alert" : "status"}>{dropFeedback.text}</div>}
        <div ref={mistakeListRef} className="mistakeList mistakeListBody">
          {revealedRecord && <MistakeListItem item={revealedRecord} selected canDrag={canDragCard && revealedRecord.noteAvailable} onPreview={() => openDetail(revealedRecord.recordId)} />}
          {records.map(item => <MistakeListItem key={item.recordId} item={item} selected={selectedId === item.recordId} selectable={selecting} canDrag={canDragCard && item.noteAvailable} checked={selectedSet.has(item.recordId)} onPreview={() => openDetail(item.recordId)} onToggle={() => toggleRecord(item.recordId)} />)}
          {!records.length && !revealedRecord && <Empty title="没有符合条件的错题" text="清空搜索或筛选条件后重试。" />}
        </div>
      </aside>
      <div className={`detailPane mistakeDetailSurface ${selecting ? "batchSelectionPane" : ""}`}>{detail ? <MistakeDetail fsrsActive={props.fsrsActive} key={detail.record.recordId} detail={detail} customCategories={props.customCategories} action={action} reloadDetail={reloadDetail} onRemoved={onRemoved} onReview={props.onReview} showLocateHint={props.showLocateHint} onOpenLinkedQuestion={props.openLinkedDetail} /> : <Empty title="选择一道错题" text="右侧将显示题目、答案、分类和定位操作。" />}</div>
    </MistakeLayout>
  </section>
}

function CategoryCascade({ records, path, setPath, favoritesActive, favoritesCount, onFavoritesToggle }) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(path)
  const triggerRef = useRef(null)
  const popoverPos = useAnchoredPopover(open, triggerRef, Math.min(330, (typeof window !== "undefined" ? window.innerWidth : 330) - 28))
  const popoverRef = useRef(null)
  useScrollDismiss(open, () => setOpen(false), popoverRef)
  const choices = categoryChoices(records, cursor)
  const currentCount = records.filter(record => cursor.every((part, index) => (record.categoryPath || [])[index] === part)).length
  function toggle() {
    setCursor(path)
    setOpen(value => !value)
  }
  function choose(item) {
    const next = [...cursor, item.name]
    setPath(next)
    if (categoryChoices(records, next).length) setCursor(next)
    else setOpen(false)
  }
  return <div className="categoryTree">
    <button ref={triggerRef} className="categoryTrigger" onClick={toggle}><span>{path.length ? path.join(" › ") : "全部分类"}{favoritesActive && <svg className="categoryTriggerStar" viewBox="0 0 256 256" width="11" height="11" fill="#f6b100" stroke="#f6b100" strokeWidth="4" aria-hidden="true"><path d="M243,96a20.33,20.33,0,0,0-17.74-14l-56.59-4.57L146.83,24.62a20.36,20.36,0,0,0-37.66,0L87.35,77.44,30.76,82A20.45,20.45,0,0,0,19.1,117.88l43.18,37.24-13.2,55.7A20.37,20.37,0,0,0,79.57,233L128,203.19,176.43,233a20.39,20.39,0,0,0,30.49-22.15l-13.2-55.7,43.18-37.24A20.43,20.43,0,0,0,243,96Z"/></svg>}</span><b><Icon name={open ? "up" : "down"} /></b></button>
    {open && popoverPos && createPortal(<div className="categoryPopover" ref={popoverRef} style={POPOVER_ABSOLUTE(popoverPos)}>
      <div className="categoryPopoverHead"><button disabled={!cursor.length} onClick={() => setCursor(cursor.slice(0, -1))}><Icon name="left" /></button><strong>{cursor.length ? cursor.join(" › ") : "选择一级分类"}</strong><button onClick={() => setOpen(false)}><Icon name="close" /></button></div>
      <button className="categoryAll" onClick={() => { setPath([]); setCursor([]); setOpen(false) }}>全部错题 <b>{records.length}</b></button>
      <button className={"categoryFavorites" + (favoritesActive ? " active" : "")} onClick={() => { onFavoritesToggle(!favoritesActive); setOpen(false) }}>
        <svg viewBox="0 0 256 256" width="13" height="13" fill="#f6b100" stroke="#f6b100" strokeWidth="1.8"><path d="M243,96a20.33,20.33,0,0,0-17.74-14l-56.59-4.57L146.83,24.62a20.36,20.36,0,0,0-37.66,0L87.35,77.44,30.76,82A20.45,20.45,0,0,0,19.1,117.88l43.18,37.24-13.2,55.7A20.37,20.37,0,0,0,79.57,233L128,203.19,176.43,233a20.39,20.39,0,0,0,30.49-22.15l-13.2-55.7,43.18-37.24A20.43,20.43,0,0,0,243,96Z"/></svg>
        收藏题目 <b>{favoritesCount}</b>
      </button>
      {!!cursor.length && <button className="categoryCurrent" onClick={() => { setPath(cursor); setOpen(false) }}>查看当前分类下全部错题 <b>{currentCount}</b></button>}
      <div className="categoryOptions">{choices.map(item => {
        const hasChildren = categoryChoices(records, [...cursor, item.name]).length > 0
        return <button key={item.name} onClick={() => choose(item)}><span>{item.name}</span><b>{item.count}{hasChildren ? "　›" : ""}</b></button>
      })}{!choices.length && <small>当前分类没有下级</small>}</div>
    </div>, document.body)}
  </div>
}

function MindMapMultiSelect({ options, selectedKeys, setSelectedKeys, title = "统计脑图", allowEmpty = false, emptyLabel = "请选择脑图" }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const selectedOptions = options.filter(option => selectedSet.has(option.key))
  const label = !selectedKeys.length
    ? emptyLabel
    : selectedKeys.length === options.length
    ? `全部 ${options.length} 个脑图`
    : selectedKeys.length === 1
      ? selectedOptions[0]?.name || "1 个脑图"
      : `已选 ${selectedKeys.length} 个脑图`

  useEffect(() => {
    if (!open) return undefined
    const close = event => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener("pointerdown", close, true)
    return () => document.removeEventListener("pointerdown", close, true)
  }, [open])

  function toggle(key) {
    setSelectedKeys(current => {
      if (current.includes(key)) return current.length > 1 || allowEmpty ? current.filter(item => item !== key) : current
      return [...current, key]
    })
  }

  const allSelected = options.length > 0 && selectedKeys.length === options.length

  return <div className={`mindMapSelect ${open ? "open" : ""}`} ref={ref}>
    <button type="button" className="mindMapSelectTrigger" onClick={() => setOpen(value => !value)}><span>{label}</span><Icon name={open ? "up" : "down"} /></button>
    {open && <div className="mindMapSelectMenu">
      <div className="mindMapSelectHead"><strong>{title}</strong><button type="button" onClick={() => setSelectedKeys(allSelected && allowEmpty ? [] : options.map(option => option.key))}><MorphIcon from="checkbox" to="checkboxChecked" active={allSelected} /><span>{allSelected && allowEmpty ? "全不选" : "全选"}</span></button></div>
      <div className="mindMapSelectOptions">{options.map(option => <button type="button" key={option.key} className={selectedSet.has(option.key) ? "selected" : ""} onClick={() => toggle(option.key)}><span className="optionCheckbox"><MorphIcon from="checkbox" to="checkboxChecked" active={selectedSet.has(option.key)} /></span><span><strong>{option.name}</strong><small>{option.notebook}</small></span><b>{option.count}</b></button>)}</div>
    </div>}
  </div>
}

// 学习历史：参考错题统计样式——横轴日期，纵轴每列一根"新增（下）/复习（上）"
// 圆头胶囊条；最近一周 / 按月（30 天）两个页签；点击列在条顶显示当日总数，
// 底部给出当日新增/复习大数字读数。
const STUDY_HISTORY_TABS = [[7, "最近一周"], [30, "按月查看"]]
function StudyHistoryChart({ records }) {
  const [range, setRange] = useState(7)
  const [picked, setPicked] = useState(null)
  const todayKey = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }, [])
  const buckets = useMemo(() => {
    const reviewMap = new Map(), addedMap = new Map()
    const dayOf = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
    for (const record of records) {
      for (const entry of record.history || []) {
        const key = dayOf(entry.at)
        if (key !== null) reviewMap.set(key, (reviewMap.get(key) || 0) + 1)
      }
      const added = dayOf(record.createdAt)
      if (added !== null) addedMap.set(added, (addedMap.get(added) || 0) + 1)
    }
    return Array.from({ length: range }, (_, index) => {
      const key = todayKey - (range - 1 - index) * 86400000
      const date = new Date(key)
      return { key, label: `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, review: reviewMap.get(key) || 0, added: addedMap.get(key) || 0 }
    })
  }, [records, range, todayKey])
  const max = Math.max(1, ...buckets.map(bucket => bucket.review + bucket.added))
  const active = buckets.find(bucket => bucket.key === picked) || buckets[buckets.length - 1]
  const row = (type, label) => <div className={`studyHistoryRow ${type}`}>
    <span className="studyHistoryRowLabel">{label}</span>
    <div className="studyHistoryBars">{buckets.map(bucket => {
      const count = bucket[type]
      return <button type="button" key={String(bucket.key)} className={picked?.key === bucket.key && picked?.type === type ? "picked" : ""} style={{ height: `${count ? Math.max(14, count / max * 56) : 4}px` }} aria-label={`${bucket.label}${label} ${count} 题`} onClick={() => setPicked(current => current?.key === bucket.key && current?.type === type ? null : { key: bucket.key, type })} />
    })}</div>
  </div>
  const pickedBucket = picked ? buckets.find(bucket => bucket.key === picked) : null
  return <div className="studyHistory">
    <div className="studyHistoryTabs">{STUDY_HISTORY_TABS.map(([days, label]) => <button type="button" key={label} className={range === days ? "active" : ""} onClick={() => { setRange(days); setPicked(null) }}>{label}</button>)}
      <span className="studyHistoryLegend"><i className="legendAdded" />新增<i className="legendReview" />复习</span>
    </div>
    <div className="studyHistoryPlot">
      {buckets.map((bucket, index) => {
        const isPicked = bucket.key === active.key
        const isToday = bucket.key === todayKey
        return <button type="button" key={String(bucket.key)} className={`historyCol${isPicked ? " picked" : ""}${isToday ? " today" : ""}`} aria-label={`${bucket.label} 新增 ${bucket.added} 题 复习 ${bucket.review} 题`} onClick={() => setPicked(bucket.key)}>
          <span className="historyCount">{isPicked ? bucket.review + bucket.added : ""}</span>
          <span className="historyPills"><i className="pillReview" style={{ height: `${bucket.review ? Math.max(6, bucket.review / max * 110) : 0}px` }} /><i className="pillAdded" style={{ height: `${bucket.added ? Math.max(6, bucket.added / max * 110) : 0}px` }} /></span>
          <span className="historyLabel">{isToday ? "今日" : range === 7 || index % 5 === 4 || index === 0 ? bucket.label : ""}</span>
        </button>
      })}
    </div>
    <div className="studyHistoryStats">
      <div><span>当日新增</span><strong>{active.added}</strong><em>题</em></div>
      <div><span>当日复习</span><strong>{active.review}</strong><em>题</em></div>
    </div>
  </div>
}

function MistakeOverview({ records, dayCounts, onBrowse, onOpen, onSource, extra }) {
  const now = Date.now()
  if (dayCounts === undefined) dayCounts = reviewDayStatus(records).counts
  const { today: due, overdue } = dayCounts ?? {}
  const weak = records.filter(item => item.level <= 1).length
  const mastered = records.filter(item => item.level === 2).length
  const recentCount = records.filter(item => now - new Date(item.createdAt).getTime() <= 7 * 86400000).length
  const levelCounts = levelNames.map((_, level) => records.filter(item => item.level === level).length)
  const maxLevelCount = Math.max(1, ...levelCounts)
  const recent = [...records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5)
  const mindMaps = useMemo(() => buildMindMapOptions(records), [records])
  const mindMapSignature = mindMaps.map(map => map.key).join("\u001f")
  const [selectedMapKeys, setSelectedMapKeys] = useState([])
  useEffect(() => {
    const available = mindMaps.map(map => map.key)
    setSelectedMapKeys(current => {
      const kept = current.filter(key => available.includes(key))
      return kept.length ? kept : available
    })
  }, [mindMapSignature])
  const effectiveMapKeys = selectedMapKeys.length ? selectedMapKeys : mindMaps.map(map => map.key)
  const parentInsights = useMemo(() => buildParentInsights(records, effectiveMapKeys), [records, effectiveMapKeys.join("\u001f")])
  const sources = parentInsights.groups
  const sourceColors = ["#0f172a", "#657c68", "#c4a16b", "#df806e", "#64748b", "#8b7b86", "#94a3b8", "#7c8da6"]
  const topSources = sources.slice(0, 7)
  const remainingSources = sources.slice(7)
  const otherCount = remainingSources.reduce((sum, source) => sum + source.count, 0)
  const otherWeak = remainingSources.reduce((sum, source) => sum + source.weak, 0)
  const chartSources = [...topSources, ...(otherCount ? [{ key: "other", name: "其他父节点", mapName: `${remainingSources.length} 个父节点`, notebook: "", count: otherCount, weak: otherWeak, path: null }] : [])]
  const mastery = records.length ? Math.round(mastered / records.length * 100) : 0
  const cards = [
    ["total", "错题总数", records.length, `${mindMaps.length} 棵题目脑图`],
    ["due", "今日到期", due ?? "—", overdue ? `另有 ${overdue} 道已逾期` : due === 0 ? "当前已清空" : ""],
    ["weak", "需要巩固", weak, "不会或不熟"],
    ["mastered", "掌握", mastered, "稳定完成"],
    ["added", "近 7 天新增", recentCount, "持续积累"],
  ]
  return <section className="overviewPage">
    <div className="overviewHero"><div><span className="overviewKicker">学习概览</span><strong>错题本学习进度</strong><small>{dayCounts ? `今日到期 ${due} 道，已逾期 ${overdue} 道` : "正在读取复习进度…"}</small></div><div className="masteryRing" style={{ "--progress": `${mastery * 3.6}deg` }}><span><strong>{mastery}%</strong><small>掌握</small></span></div><div className="previewLearningProgress" data-preview-learning-progress="1"><div className="previewProgressHeading"><span>共 {records.length} 道</span></div><div className="previewProgressTrack" role="img" aria-label={levelNames.map((name, index) => `${name} ${levelCounts[index]} 道`).join("，")}>{levelCounts.map((count, index) => ({ count, index })).filter(item => item.count > 0).map(({ count, index }) => <i className={`level${index}`} key={levelNames[index]} style={{ width: `${records.length ? count / records.length * 100 : 0}%` }} />)}</div><div className="previewProgressLegend">{levelCounts.map((count, index) => <span key={levelNames[index]}><i className={`level${index}`} />{levelNames[index]}<b>{count}</b><em>{records.length ? Math.round(count / records.length * 100) : 0}%</em></span>)}</div></div></div>
    <div className="overviewCards">{cards.map(([icon, label, value, note], index) => <div className={`overviewCard tone${index}`} key={label}><i><Icon name={icon} /></i><span><small>{label}</small><strong>{value}</strong><em>{note}</em></span></div>)}</div>
    {extra}
    <div className="overviewPanel sourcePanel"><header><div><strong>错题来源分布</strong></div>{mindMaps.length ? <MindMapMultiSelect options={mindMaps} selectedKeys={effectiveMapKeys} setSelectedKeys={setSelectedMapKeys} /> : null}</header>{sources.length ? <div className="sourceChart"><DistributionDonut segments={chartSources.map((source, index) => ({ value: source.count, color: sourceColors[index] }))} total={parentInsights.classifiedRecords} label="错题来源分布"><span><strong>{parentInsights.classifiedRecords}</strong><small>有效分类</small></span></DistributionDonut><div className="sourceBars">{chartSources.map((source, index) => {
      const percent = Math.round(source.count / Math.max(1, parentInsights.classifiedRecords) * 100)
      return <button key={source.key} disabled={!source.path?.length} onClick={() => source.path?.length && onSource(source.path)}><i style={{ background: sourceColors[index] }} /><span><strong>{source.name}</strong><small>{source.mapName}{source.weak ? ` · ${source.weak} 道薄弱` : ""}</small><em><b style={{ width: `${percent}%`, background: sourceColors[index] }} /></em></span><b>{source.count}<small>{percent}%</small></b></button>
    })}</div></div> : mindMaps.length ? <Empty title="暂无有效父节点分类" text="所选脑图的父节点当前会形成“一题一类”或“全部一类”，已自动跳过无效统计。" icon={false} /> : <Empty title="暂无来源数据" text="标记错题后可按题目脑图内父节点统计。" icon={false} />}
    <StudyHistoryChart records={records} />
    </div>
    <div className="overviewGrid">
      <div className="overviewPanel"><header><strong>三档掌握情况</strong><small>不会、不熟、掌握</small></header><div className="levelChart">{levelCounts.map((count, level) => <div className="levelRow" key={level}><span>{levelNames[level]}</span><div><i className={`levelBar level${level}`} style={{ width: `${Math.max(count ? 8 : 0, count / maxLevelCount * 100)}%` }} /></div><b>{count}</b></div>)}</div></div>
      <div className="overviewPanel recentPanel"><header><strong>最近添加</strong><button onClick={onBrowse}>浏览全部</button></header><div>{recent.map(item => <button className="recentItem" key={item.recordId} onClick={() => onOpen(item.recordId)}><span className={`level level${item.level}`}>{levelNames[item.level]}</span><span><strong>{item.sourceTitle}</strong><small>{formatDate(item.createdAt)} · {item.reviewCompleted ? "已结束" : reviewCountdown(item.nextReviewAt)}</small></span><b><Icon name="right" /></b></button>)}{!recent.length && <Empty title="还没有错题" text="从卡片侧边标记第一道错题。" />}</div></div>
    </div>
  </section>
}

const EXPORT_PREVIEW_FRAME_WIDTH = 760
const EXPORT_PREVIEW_SCALE = 0.6
function ExportHtmlPreview({ html }) {
  const [frameHeight, setFrameHeight] = useState(1080)
  function onLoad(event) {
    const doc = event.currentTarget.contentDocument
    if (doc?.body) setFrameHeight(Math.max(1080, doc.documentElement.scrollHeight || 0, doc.body.scrollHeight || 0))
  }
  return <div className="actualPreviewViewport">
    <div className="actualPreviewScaled" style={{ height: `${Math.round(frameHeight * EXPORT_PREVIEW_SCALE)}px` }}>
      <PreviewFrame title="实际 PDF 导出预览" html={html} onLoad={onLoad}
        style={{ width: `${EXPORT_PREVIEW_FRAME_WIDTH}px`, height: `${frameHeight}px`, transform: `scale(${EXPORT_PREVIEW_SCALE})`, transformOrigin: "0 0" }} />
    </div>
  </div>
}

const MistakeListItem = React.memo(function MistakeListItem({ item, selected, selectable, canDrag, checked, onPreview, onToggle }) {
  const manualTags = Array.from(new Set(filterableMistakeTags(item)))
  const reviewState = compactReviewStatus(item)
  return <div role="button" tabIndex={0} data-mistake-drag-record={canDrag ? item.recordId : undefined} title={canDrag ? "长按并拖到脑图卡片，添加原题链接" : undefined} className={`mistakeItem ${selected ? "selected" : ""} ${checked ? "checked" : ""} ${selectable ? "selectable" : ""} ${item.noteAvailable ? "" : "unavailable"}`} onClick={onPreview} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPreview() } }}>{selectable && <AnimatedCheckbox className="batchCheckControl" label={`选择 ${item.sourceTitle}`} checked={checked} onChange={onToggle} />}<span className="mistakeItemBody"><span className="mistakeTitleRow"><strong>{item.sourceTitle}</strong><span className={`level level${item.level}`}>{levelNames[item.level]}</span></span><small className="mistakeSourceLine">{item.categoryLabel}{item.noteAvailable ? "" : " · 原卡片不可用"}</small><span className={`mistakeItemFooter ${manualTags.length ? "hasTags" : "noTags"}`}><small className={`mistakeReviewState ${reviewState === "已逾期" ? "overdue" : item.reviewCompleted ? "completed" : ""}`}>{reviewState}</small>{item.favorite === true && <><span className="mistakeMetaDivider" aria-hidden="true">·</span><span className="mistakeFavoriteSlot" title="已收藏"><span className="mistakeFavoriteMark"><Icon name="star" /></span><span className="mistakeFavoriteText">已收藏</span></span></>}{manualTags.length > 0 && <span className="mistakeMetaDivider" aria-hidden="true">·</span>}<span className="mistakeItemTags">{manualTags.map(tag => <em key={tag}>#{tag}</em>)}</span></span></span></div>
}, (previous, next) => previous.item === next.item && previous.selected === next.selected && previous.selectable === next.selectable && previous.checked === next.checked)

const TIMELINE_NODE_WIDTH = 64
const TIMELINE_ROW_HEIGHT = 76
const TIMELINE_SIDE_INSET = 34

function buildSerpentineTimeline(history, width, gapForIndex) {
  const safeWidth = Math.max(220, Number(width) || 360)
  const left = TIMELINE_SIDE_INSET
  const right = safeWidth - TIMELINE_SIDE_INSET
  const span = Math.max(TIMELINE_NODE_WIDTH, right - left)
  const positions = []
  let row = 0
  let progress = 0
  for (let index = 0; index < history.length; index++) {
    if (index > 0) {
      const scaledGap = Math.min(Math.max(18, gapForIndex(history, index - 1)), Math.max(56, span / 3))
      const distance = TIMELINE_NODE_WIDTH + scaledGap
      if (progress + distance > span) {
        row += 1
        progress = 0
      } else {
        progress += distance
      }
    }
    const reverse = row % 2 === 1
    positions.push({ index, row, x: reverse ? right - progress : left + progress, y: 42 + row * TIMELINE_ROW_HEIGHT })
  }
  if (!positions.length) return { positions, path: "", height: 0 }
  const rows = positions.reduce((groups, position) => {
    ;(groups[position.row] ||= []).push(position)
    return groups
  }, [])
  let path = `M ${rows[0][0].x} ${rows[0][0].y}`
  rows.forEach((rowPositions, rowIndex) => {
    for (let index = rowIndex === 0 ? 1 : 0; index < rowPositions.length; index++) {
      path += ` L ${rowPositions[index].x} ${rowPositions[index].y}`
    }
    const reverse = rowIndex % 2 === 1
    const edgeX = reverse ? left : right
    const nextRow = rows[rowIndex + 1]
    if (nextRow) {
      const bulge = reverse ? -18 : 18
      const y = rowPositions[0].y
      const nextY = nextRow[0].y
      path += ` L ${edgeX} ${y} C ${edgeX + bulge} ${y}, ${edgeX + bulge} ${nextY}, ${edgeX} ${nextY}`
    }
  })
  const last = positions[positions.length - 1]
  const arrowRoom = last.row % 2 === 1 ? Math.max(12, last.x - left + 22) : Math.max(12, right - last.x + 22)
  const arrowEnd = last.row % 2 === 1 ? last.x - Math.min(28, arrowRoom) : last.x + Math.min(28, arrowRoom)
  path += ` L ${arrowEnd} ${last.y}`
  return { positions, path, height: last.y + 42 }
}

function ReviewTimeline({ history, gapForIndex }) {
  const listRef = useRef(null)
  const [width, setWidth] = useState(360)
  const markerId = `review-timeline-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const update = () => setWidth(current => {
      const next = Math.round(list.clientWidth || list.getBoundingClientRect().width || 360)
      return Math.abs(next - current) > 1 ? next : current
    })
    update()
    if (typeof ResizeObserver !== "function") return undefined
    const observer = new ResizeObserver(update)
    observer.observe(list)
    return () => observer.disconnect()
  }, [])
  const layout = useMemo(() => buildSerpentineTimeline(history, width, gapForIndex), [history, width, gapForIndex])

  return <ol ref={listRef} className="serpentineTimeline" aria-label="复测历史蛇形时间轴" style={{ height: `${layout.height}px` }}>
    <svg className="reviewTimelinePath" viewBox={`0 0 ${width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" /></marker></defs>
      <path d={layout.path} markerEnd={`url(#${markerId})`} />
    </svg>
    {layout.positions.map(position => {
      const entry = history[position.index]
      return <li key={`${entry.at}:${position.index}`} title={entry.errorReason?.label ? `错因：${entry.errorReason.label}` : undefined} style={{ left: `${position.x}px`, top: `${position.y}px` }}><span className="previewTimelineBody"><b className={`level${entry.level}`}>{entry.label || levelNames[entry.level] || levelNames[0]}</b>{entry.errorReason?.label && <small className="previewTimelineReason">错因：{entry.errorReason.label}</small>}</span><i className={`previewTimelineDot level${entry.level}`} /><small className="previewTimelineDate">{formatDate(entry.at)}</small></li>
    })}
  </ol>
}

function ReviewAnswer({ detail, title }) {
  const [answerIndex, setAnswerIndex] = useState(0)
  const [answerZoom, setAnswerZoom] = useState(100)
  const answer = detail.answers?.[Math.min(answerIndex, Math.max(0, detail.answers.length - 1))]
  return <div className="dueAnswer">
    <div className="answerPreviewToolbar"><strong>答案预览</strong><div role="group" aria-label="答案缩放"><button type="button" aria-label="缩小答案" disabled={answerZoom <= 60} onClick={() => setAnswerZoom(value => Math.max(60, value - 10))}>−</button><button type="button" className="answerZoomReset" aria-label="恢复答案原始大小" onClick={() => setAnswerZoom(100)}>{answerZoom}%</button><button type="button" aria-label="放大答案" disabled={answerZoom >= 300} onClick={() => setAnswerZoom(value => Math.min(300, value + 10))}>＋</button></div></div>
    {detail.answers?.length > 1 && <select value={answerIndex} onChange={event => { setAnswerIndex(Number(event.target.value)); setAnswerZoom(100) }}>{detail.answers.map((candidate, index) => <option value={index} key={candidate.id}>{candidate.title} · {candidate.path}</option>)}</select>}
    {answer ? <div className="reviewAnswerViewport"><CardPreview key={`${answer.id || answerIndex}`} title={`${title}答案`} noteId={answer.id} html={answer.html} zoom={answerZoom} onZoom={setAnswerZoom} /></div> : <Empty title={detail.answerStatus === "unbound" ? "来源脑图尚未绑定答案" : "没有匹配到答案"} text="答案按原题脑图当前绑定实时查询。" />}
  </div>
}

function retainReviewDetail(current, recordId, detail) {
  const next = { ...current }
  delete next[recordId]
  // 取消索引处理后允许下一次打开答案重新查询，不能永久缓存空答案。
  if (detail.answerStatus === "index-missing") return next
  next[recordId] = detail
  while (Object.keys(next).length > 6) delete next[Object.keys(next)[0]]
  return next
}

function DueReviewList({ adapter, records, reviewCurves, action, manualTodayIds, showLocateHint, focusRecordId, onRecordChanged, commentExpandCount = 2, handwritingAvailable = false }) {
  const names = adapter?.names || levelNames
  const contentReader = useRef(adapter?.content)
  contentReader.current = adapter?.content
  const [handwritingBusy, setHandwritingBusy] = useState(false)
  const handwritingPending = useRef(false)
  async function openQueueHandwriting(recordId) {
    if (!handwritingAvailable) {
      showLocateHint?.("当前使用经典面板，整卡手写未启用。请先在设置 → 关于插件开启“场景面板与批注手写”；需软件5.0.0及以上并启用场景模式，启用后重新打开窗口生效。")
      return
    }
    if (handwritingPending.current) return
    handwritingPending.current = true
    setHandwritingBusy(true)
    try { await action("openMistakeHandwriting", { recordId }, false) }
    finally { handwritingPending.current = false; setHandwritingBusy(false) }
  }
  const [answerDetail, setAnswerDetail] = useState(null)
  const [answerLoadingId, setAnswerLoadingId] = useState("")
  const preferenceScope = adapter ? "review.fsrs." : "review.fixed."
  const [savedStatus, setActiveFilter] = useWorkbenchPreference(preferenceScope + "status", "today", REVIEW_STATES)
  const [useFocusedRecord, setUseFocusedRecord] = useState(true)
  const [historyOpen, setHistoryOpen] = useState({})
  const [feedbackById, setFeedbackById] = useState({})
  const filterNames = [...(adapter ? [[-1, "待反馈"]] : []), ...names.map((name, level) => [level, name])]
  const allLevels = filterNames.map(([level]) => level)
  const [customLevels, setLevels] = useWorkbenchPreference(preferenceScope + "levels", null)
  const [selectedIds, setSelectedIds] = useWorkbenchPreference(preferenceScope + "sources", null, null, true)
  const [sortOrder, setSortOrder] = useWorkbenchPreference(preferenceScope + "order", "remaining", REVIEW_ORDERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [queueNotice, setQueueNotice] = useState("")
  const [detailsById, setDetailsById] = useState({})
  const [questionsById, setQuestionsById] = useState({})
  const [questionErrorsById, setQuestionErrorsById] = useState({})
  const [questionLoadRevision, setQuestionLoadRevision] = useState(0)
  const [questionOpenById, setQuestionOpenById] = useState({})
  const [jumpHighlightedId, setJumpHighlightedId] = useState("")
  const detailLoadingRef = useRef(new Set())
  const annotationRevisions = useRef({})
  const detailCache = useMemo(() => createReviewDetailCache(recordId => contentReader.current ? contentReader.current(recordId) : MNBridge.send("mistakeDetail", { recordId })), [])
  const questionCache = useMemo(() => createReviewDetailCache(recordId => contentReader.current ? contentReader.current(recordId) : MNBridge.send("mistakeQuestion", { recordId })), [])
  const mountedRef = useRef(true)
  const questionOpenRef = useRef(questionOpenById)
  questionOpenRef.current = questionOpenById
  const reviewPageRef = useRef(null)

  useEffect(() => {
    const saved = event => {
      const recordId = event.detail?.recordId
      if (!recordId) return
      annotationRevisions.current[recordId] = (annotationRevisions.current[recordId] || 0) + 1
      detailCache.clear()
      questionCache.clear()
      const withoutSaved = current => { const next = { ...current }; delete next[recordId]; return next }
      setDetailsById(withoutSaved)
      setQuestionsById(withoutSaved)
      setQuestionErrorsById(withoutSaved)
      setAnswerDetail(current => current?.record?.recordId === recordId ? null : current)
      setQuestionLoadRevision(current => current + 1)
    }
    window.addEventListener("cardlink:annotation-saved", saved)
    return () => window.removeEventListener("cardlink:annotation-saved", saved)
  }, [detailCache, questionCache])

  useEffect(() => () => { mountedRef.current = false }, [])

  useEffect(() => {
    if (reviewPageRef.current) reviewPageRef.current.scrollTop = 0
  }, [])



  useEffect(() => {
    if (!filtersOpen && !menuOpen) return
    const dismiss = event => { if (!event.target.closest?.(".reviewActionCapsule")) { setFiltersOpen(false); setMenuOpen(false) } }
    const escape = event => { if (event.key === "Escape") { setFiltersOpen(false); setMenuOpen(false) } }
    document.addEventListener("pointerdown", dismiss)
    document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape) }
  }, [filtersOpen, menuOpen])

  const { counts, statusOf, startToday } = reviewDayStatus(records, manualTodayIds)
  const focusedRecord = useFocusedRecord && records.find(record => record.recordId === focusRecordId)
  const activeFilter = focusedRecord ? statusOf(focusedRecord) : savedStatus
  const levels = (!focusedRecord && customLevels) || allLevels
  useLayoutEffect(() => {
    const target = Array.from(reviewPageRef.current?.querySelectorAll("[data-review-id]") || []).find(node => node.dataset.reviewId === focusRecordId)
    if (!target) return undefined
    const page = reviewPageRef.current
    function centerTarget() {
      const pageRect = page.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const topBarBottom = document.querySelector(".topBar")?.getBoundingClientRect().bottom ?? pageRect.top
      const viewportBottom = window.visualViewport
        ? window.visualViewport.offsetTop + window.visualViewport.height
        : window.innerHeight
      const visibleTop = Math.max(pageRect.top, topBarBottom)
      const visibleBottom = Math.min(pageRect.bottom, viewportBottom)
      const desiredTop = page.scrollTop + (targetRect.top + targetRect.bottom - visibleTop - visibleBottom) / 2
      const maxScrollTop = Math.max(0, page.scrollHeight - page.clientHeight)
      page.scrollTop = Math.max(0, Math.min(desiredTop, maxScrollTop))
    }
    let correction = 0
    const timer = requestAnimationFrame(() => {
      centerTarget()
      correction = requestAnimationFrame(() => centerTarget())
      target.focus({ preventScroll: true })
      setJumpHighlightedId(focusRecordId)
    })
    const clear = window.setTimeout(() => setJumpHighlightedId(current => current === focusRecordId ? "" : current), 1800)
    return () => { cancelAnimationFrame(timer); cancelAnimationFrame(correction); clearTimeout(clear) }
  }, [focusRecordId, activeFilter, records.length])
  const visibleRecords = sortReviewRecords(records.filter(item => statusOf(item) === activeFilter &&
    levels.includes(item.level) && (focusedRecord || selectedIds === null || selectedIds.has(item.recordId))), sortOrder)
  const visibleSignature = visibleRecords.map(item => item.recordId).join("\u001f")
  // A+B 懒加载：完整原题默认收起，点开才建 iframe、才取详情
  const allQuestionsOpen = visibleRecords.length > 0 && visibleRecords.every(item => questionOpenById[item.recordId] === true)

  function toggleAllQuestions() {
    const nextOpen = !allQuestionsOpen
    setQuestionOpenById(current => {
      const next = { ...current }
      for (const item of visibleRecords) next[item.recordId] = nextOpen
      questionOpenRef.current = next
      return next
    })
    if (!nextOpen) {
      const visibleIds = new Set(visibleRecords.map(item => item.recordId))
      setQuestionsById(current => Object.fromEntries(Object.entries(current).filter(([recordId]) => !visibleIds.has(recordId))))
      setQuestionErrorsById(current => Object.fromEntries(Object.entries(current).filter(([recordId]) => !visibleIds.has(recordId))))
    }
  }

  async function beginReviewMode() {
    if (!visibleRecords.length) return
    if (adapter) return adapter.start(visibleRecords)
    await action("startReviewMode", {
      records: visibleRecords.map(item => ({
        recordId: item.recordId,
        sourceNoteId: item.sourceNoteId,
        sourceNotebookId: item.sourceNotebookId,
        sourceRootNodeId: item.sourceRootNodeId,
        sourceTitle: item.sourceTitle,
        sourceNotebookTitle: item.sourceNotebookTitle,
        sourceRootTitle: item.sourceRootTitle,
        sourcePathTitles: item.sourcePathTitles,
        level: item.level,
        reviewCount: item.reviewCount,
        history: item.history
      }))
    }, false)
  }

  function toggleQuestion(recordId) {
    const nextOpen = !(questionOpenById[recordId] === true)
    setQuestionOpenById(current => {
      const next = { ...current, [recordId]: nextOpen }
      questionOpenRef.current = next
      return next
    })
    if (!nextOpen) {
      setQuestionsById(current => { const next = { ...current }; delete next[recordId]; return next })
      setQuestionErrorsById(current => { const next = { ...current }; delete next[recordId]; return next })
    }
  }

  // 原题只为已展开记录加载：切进待复习页不触发整页桥请求。
  const openSignature = visibleRecords
    .filter(item => questionOpenById[item.recordId] === true)
    .map(item => item.recordId)
    .join("")
  useEffect(() => {
    const queue = visibleRecords
      .filter(item => questionOpenById[item.recordId] === true)
      .filter(item => !questionsById[item.recordId] && !questionErrorsById[item.recordId] && !detailLoadingRef.current.has(item.recordId))
      .map(item => item.recordId)
    // 协调器负责双并发；已经发出的单题任务不因筛选或折叠变化被作废，
    // 否则请求回包后没有状态落点，该卡片会永久停留在“正在读取”。
    for (const recordId of queue) {
      detailLoadingRef.current.add(recordId)
      const version = records.find(item => item.recordId === recordId)?.updatedAt || ""
      const annotationRevision = annotationRevisions.current[recordId] || 0
      void questionCache.get(recordId, version).then(question => {
        if ((annotationRevisions.current[recordId] || 0) !== annotationRevision) return
        if (mountedRef.current && question && questionOpenRef.current[recordId] === true) {
          // 请求协调器的复用缓存有界；当前实际展开的题目必须全部保留，
          // 否则展开超过 6 题时先完成的卡片会被淘汰并退回永久加载态。
          setQuestionsById(current => ({ ...current, [recordId]: question }))
          if (question.record) onRecordChanged?.(question.record)
          setQuestionErrorsById(current => {
            if (!current[recordId]) return current
            const next = { ...current }; delete next[recordId]; return next
          })
        }
      }).catch(error => {
        if ((annotationRevisions.current[recordId] || 0) !== annotationRevision) return
        if (mountedRef.current && questionOpenRef.current[recordId] === true) setQuestionErrorsById(current => ({
          ...current,
          [recordId]: String(error?.message || error || "读取失败")
        }))
      }).finally(() => {
        detailLoadingRef.current.delete(recordId)
        if (mountedRef.current && (annotationRevisions.current[recordId] || 0) !== annotationRevision) setQuestionLoadRevision(current => current + 1)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSignature, openSignature, questionLoadRevision])

  function retryQuestion(recordId) {
    setQuestionErrorsById(current => {
      const next = { ...current }; delete next[recordId]; return next
    })
    setQuestionLoadRevision(current => current + 1)
  }

  function nextDays(item, level) {
    if (adapter) return item.preview?.[level]?.days ?? "—"
    const curve = reviewCurves?.[level] || defaultReviewCurves[level]
    const index = level === item.level ? Math.min(item.reviewCount + 1, curve.length - 1) : 0
    return Number(curve[index]) || defaultReviewCurves[level][0]
  }

  function endsReview(item, level) {
    return !adapter && level === 2 && item.level === 2
  }

  async function toggleAnswer(recordId) {
    if (answerDetail?.record?.recordId === recordId) {
      setAnswerDetail(null)
      return
    }
    setAnswerLoadingId(recordId)
    const annotationRevision = annotationRevisions.current[recordId] || 0
    try {
      const record = records.find(item => item.recordId === recordId)
      const detail = detailsById[recordId] || await detailCache.get(recordId, record?.updatedAt || "")
      if ((annotationRevisions.current[recordId] || 0) !== annotationRevision) return
      if (detail) {
        setDetailsById(current => retainReviewDetail(current, recordId, detail))
        setAnswerDetail(detail)
        onRecordChanged?.(detail.record)
      }
    } finally {
      setAnswerLoadingId("")
    }
  }

  async function complete(item, level) {
    if (adapter) { const result = await adapter.review(item, level); if (result && answerDetail?.record?.recordId === item.recordId) setAnswerDetail(null); return }
    const result = await action("reviewMistake", { recordId: item.recordId, level })
    if (!result) return
    const completed = result.reviewCompleted === true
    setFeedbackById(current => ({
      ...current,
      [item.recordId]: completed
        ? "本次结果：掌握 · 连续第二次确认，已结束自动复习并保留错题记录。"
        : `本次结果：${levelNames[level]} · ${nextDays(item, level)} 天后再次复测。`
    }))
    if (answerDetail?.record?.recordId === item.recordId) setAnswerDetail(null)
  }

  async function resume(item) {
    const result = adapter ? await adapter.resume(item) : await action("resumeMistakeReview", { recordId: item.recordId })
    if (result) setFeedbackById(current => ({ ...current, [item.recordId]: `已恢复复习计划，下次复测时间为 ${formatDate(result.nextReviewAt)}。` }))
  }

  function historyGap(history, index) {
    if (index >= history.length - 1) return 0
    const current = new Date(history[index]?.at).getTime()
    const next = new Date(history[index + 1]?.at).getTime()
    if (!Number.isFinite(current) || !Number.isFinite(next)) return 30
    const days = Math.abs(next - current) / 86400000
    return Math.round(30 + Math.min(days, 120) * 4)
  }

  async function addOverdue(count) {
    const result = adapter ? adapter.addOverdue(count) : await action("addManualTodayOverdue", { count }, false)
    if (!result) return
    if (!result.addedCount) {
      setQueueNotice("逾期池已经清空。")
      return
    }
    setQueueNotice(`已从逾期池加入 ${result.addedCount} 道题到今日队列。`)
  }

  const toolbar = <div className="settingsCapsule reviewToolbar">
      <nav aria-label="计划到期状态"><span className="settingsCapsuleSlider" aria-hidden="true" style={{ transform: `translateX(${["today", "overdue", "upcoming", "completed"].indexOf(activeFilter) * 100}%)` }} />{[
      ["today", "今日到期"], ["overdue", "已逾期"], ["upcoming", "未到期"], ["completed", adapter ? "已暂停" : "已结束"]
    ].map(([key, label]) => <button type="button" aria-pressed={activeFilter === key} className={activeFilter === key ? "active" : ""} key={key} onClick={() => { setUseFocusedRecord(false); setActiveFilter(key) }}>{label}<b>{counts[key]}</b></button>)}</nav>
      <div className="reviewActionCapsule">
      <button type="button" className={`reviewFilterToggle ${filtersOpen || selectedIds !== null || customLevels !== null ? "active" : ""}`} aria-label={filtersOpen ? "收起筛选" : "展开筛选"} aria-expanded={filtersOpen} aria-controls="reviewFilterPanel" onClick={() => { setFiltersOpen(value => !value); setMenuOpen(false) }}><Icon name="filter" />{(selectedIds !== null || customLevels !== null) && <span className="reviewFilterCount" aria-label={"筛选后 " + visibleRecords.length + " 道题"}>{visibleRecords.length}</span>}</button>
      <button type="button" className={`reviewIconButton ${menuOpen ? "active" : ""}`} aria-label="排序" title="排序" aria-expanded={menuOpen} aria-controls="reviewSortPanel" onClick={() => { setMenuOpen(value => !value); setFiltersOpen(false) }}><Icon name="sort" /></button>
      <ReviewStartButton disabled={!visibleRecords.length} onStart={beginReviewMode} />
      <button type="button" className={`reviewIconButton ${allQuestionsOpen ? "active" : ""}`} aria-label={allQuestionsOpen ? "收起全部题目" : "展开全部题目"} title={allQuestionsOpen ? "收起全部题目" : "展开全部题目"} disabled={!visibleRecords.length} onClick={toggleAllQuestions}><MorphIcon from="collapse" to="expand" active={!allQuestionsOpen} /></button>
      {filtersOpen && <div id="reviewFilterPanel" className="reviewFilterDropdown"><ReviewQueueFilters records={records} names={filterNames} levels={focusedRecord ? null : customLevels} setLevels={value => { setUseFocusedRecord(false); setLevels(focusedRecord && typeof value === "function" ? value(null) : value) }} selected={focusedRecord ? null : selectedIds} setSelected={value => { setUseFocusedRecord(false); setSelectedIds(value) }} onReset={() => { setUseFocusedRecord(false); setLevels(null); setSelectedIds(null) }} /></div>}
      {menuOpen && <div id="reviewSortPanel" className="reviewSortDropdown" role="group" aria-label="排序方式"><ReviewSortOptions value={sortOrder} onChange={key => { setSortOrder(key); setMenuOpen(false) }} /></div>}
      </div></div>
  return <section data-review-algorithm={adapter ? "fsrs" : undefined} className={`reviewPage ${filtersOpen ? "reviewFiltersOpen" : ""} ${menuOpen ? "reviewMenuOpen" : ""}`} ref={reviewPageRef}>
    {toolbar}
    {activeFilter === "today" && <div className="reviewOverdueTools"><span><strong>今日任务量不够？</strong> 从逾期池随机补充：</span>{[1, 3, 5].map(count => <button type="button" key={count} onClick={() => addOverdue(count)}>+{count} 题</button>)}</div>}
    {adapter?.notice && <div className="reviewQueueNotice" role="status">{adapter.notice}</div>}
    {queueNotice && <div className="reviewQueueNotice" role="status">{queueNotice}</div>}
    <div className="reviewList">
    {!visibleRecords.length ? <Empty title="当前队列没有题目" text="可以切换其他复习状态或掌握等级查看。" icon={false} /> : visibleRecords.map(item => {
      const expanded = answerDetail?.record?.recordId === item.recordId
      const questionDetail = questionsById[item.recordId] || detailsById[item.recordId]
      const questionError = questionErrorsById[item.recordId]
      const questionOpen = questionOpenById[item.recordId] === true
      const tags = manualTagsOf(item)
      const completed = item.reviewCompleted === true
      const itemStatus = statusOf(item)
      const dueText = itemStatus === "today" ? "今天到期"
        : itemStatus === "overdue" ? `已逾期 ${Math.max(1, Math.ceil((startToday - new Date(item.nextReviewAt).getTime()) / 86400000))} 天`
          : reviewCountdown(item.nextReviewAt)
      const schedule = completed ? (adapter ? "已暂停智能复习" : "掌握 · 连续 2 次确认") : `第 ${item.reviewCount + 1} 次复测 · ${dueText}`
      return <article data-review-id={item.recordId} tabIndex={-1} className={`dueReviewItem ${jumpHighlightedId === item.recordId ? "jumpHighlighted" : ""}`} key={item.recordId}>
        <div className="dueReviewSummary">
          <span className={`level level${Math.min(2, item.level)}`} style={adapter && item.level < 0 ? { color: "#64748b", background: "#f1f5f9" } : undefined}>{names[item.level] || "待反馈"}</span>
          <span><strong>{item.sourceTitle}</strong><small>{item.categoryLabel}</small>{tags.length > 0 && <span className="reviewTags" aria-label="错题标签">{tags.map(tag => <em key={tag}>{tag}</em>)}</span>}</span>
          <span className="reviewCardTopActions"><small className={`reviewSchedule ${statusOf(item) === "overdue" ? "overdue" : ""}`}>{schedule}</small><button type="button" className={`questionFoldButton ${questionOpen ? "active" : ""}`} aria-label={questionOpen ? `收起 ${item.sourceTitle} 的题目预览` : `展开 ${item.sourceTitle} 的题目预览`} aria-expanded={questionOpen} onClick={() => toggleQuestion(item.recordId)}><MorphIcon from="collapse" to="expand" active={!questionOpen} /></button></span>
        </div>
        {feedbackById[item.recordId] && <div className="reviewCardFeedback" role="status">{feedbackById[item.recordId]}</div>}
        {questionOpen && <section className="reviewQuestion" aria-label="完整原题"><span>完整原题</span>{questionDetail ? <CardPreview title={`${item.sourceTitle}完整原题`} noteId={item.sourceNoteId} html={questionDetail.questionHtml} initialAutoHeight defaultExpandedComments={commentExpandCount} /> : questionError ? <div className="reviewQuestionLoading reviewQuestionError">读取完整原题失败。<button type="button" onClick={() => retryQuestion(item.recordId)}>重试</button></div> : <div className="reviewQuestionLoading">正在读取完整原题…</div>}</section>}
        <div className="dueReviewActions">
          <LocateButton className="reviewLocateAction" locateKey={`mistake:${item.recordId}`} onWaiting={() => showLocateHint("正在切换学习集并定位原题，请稍候…")} onLocate={async () => {
            const located = await action("openSource", { recordId: item.recordId }, false)
            if (located?.locateHint) showLocateHint(located.locateHint)
            return located
          }}><span className="reviewActionText reviewLocateText">定位原题</span></LocateButton>
          <button className={`reviewAnswerAction ${expanded ? "active" : ""}`} disabled={answerLoadingId === item.recordId} onClick={() => toggleAnswer(item.recordId)}><MorphIcon from="eye" to="eyeOff" active={expanded} /><span className="reviewActionText reviewAnswerText">{answerLoadingId === item.recordId ? "读取答案…" : expanded ? "收起答案" : "查看答案"}</span></button>
          <button className={`reviewHistoryAction ${historyOpen[item.recordId] ? "active" : ""}`} onClick={() => setHistoryOpen(current => ({ ...current, [item.recordId]: !current[item.recordId] }))}><MorphIcon from="history" to="collapse" active={!!historyOpen[item.recordId]} /><span className="reviewActionText reviewHistoryText">{historyOpen[item.recordId] ? "收起复测历史" : `复测历史 (${item.historyCount ?? item.history?.length ?? 0})`}</span></button>
          <button type="button" className="reviewHandwriteAction" aria-label={`书写 ${item.sourceTitle}`} title={handwritingAvailable ? "直接打开该题的整卡批注面板" : "手写未启用，点击查看原因"} aria-disabled={!handwritingAvailable || handwritingBusy} disabled={handwritingBusy} onClick={() => openQueueHandwriting(item.recordId)}><Icon name="handwrite" /></button>
          {completed ? <><button onClick={() => resume(item)}>恢复复习计划</button><strong className="reviewEnded">✓ {adapter ? "已暂停" : "已结束"}</strong></> : <div className="reviewResults" role="group" aria-label="本次复测结果">{names.map((name, level) => <button data-level={level} key={name} disabled={adapter?.busy} onClick={() => complete(item, level)}>{name}<small>{endsReview(item, level) ? "结束" : `+${nextDays(item, level)} 天`}</small></button>)}</div>}
        </div>
        {adapter?.editor(item)}
        {expanded && <ReviewAnswer key={item.recordId} detail={answerDetail} title={item.sourceTitle} />}
        {historyOpen[item.recordId] && <div className="reviewHistory"><strong>复测历史</strong>{adapter ? adapter.history(item, history => <ReviewTimeline history={history} gapForIndex={historyGap} />) : item.history?.length ? <ReviewTimeline history={item.history} gapForIndex={historyGap} /> : <small>暂无复测记录</small>}</div>}
      </article>
    })}
    </div>
  </section>
}


function MistakeDetail({ fsrsActive = false, detail, customCategories, action, reloadDetail, onRemoved, showLocateHint, onReview, onOpenLinkedQuestion }) {
  const [view, setView] = useState("question")
  const [answerResult, setAnswerResult] = useState(null)
  const [answerRetry, setAnswerRetry] = useState(0)
  const deferredAnswers = detail.answerStatus === "deferred"
  const currentAnswerResult = answerResult?.source === detail ? answerResult : null
  const answerDetail = deferredAnswers ? currentAnswerResult?.data : detail
  const answerError = currentAnswerResult?.error
  useEffect(() => {
    if (view !== "answer" || !deferredAnswers || currentAnswerResult?.data) return undefined
    let cancelled = false
    setAnswerResult(null)
    MNBridge.send("mistakeDetail", { recordId: detail.record.recordId, content: "answers" }).then(data => {
      if (!cancelled) setAnswerResult({ source: detail, data })
    }).catch(error => {
      if (!cancelled) setAnswerResult({ source: detail, error: error.message || String(error) })
    })
    return () => { cancelled = true }
  }, [detail, view, answerRetry])
  const [answerIndex, setAnswerIndex] = useState(0)
  const [tags, setTags] = useState([])
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [newTag, setNewTag] = useState("")
  const [removeArmed, setRemoveArmed] = useState(false)
  const [deleteTagTarget, setDeleteTagTarget] = useState("")
  const [levelNotice, setLevelNotice] = useState("")
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [handwritingBusy, setHandwritingBusy] = useState(false)
  const handwritingPending = useRef(false)
  const bar = useDockableBar()
  const tagPickerRef = useRef(null)
  const tagTriggerRef = useRef(null)
  const tagMenuRef = useRef(null)
  const tagMenuPos = useAnchoredPopover(tagPickerOpen, tagTriggerRef, 280, "end")
  useScrollDismiss(tagPickerOpen, () => setTagPickerOpen(false), tagMenuRef)
  const reasonTags = detail.record.reasonTags ?? []
  const detailTagSignature = manualTagsOf(detail.record).join("\u001f")
  useEffect(() => {
    const saved = event => { if (event.detail?.recordId === detail.record.recordId) reloadDetail() }
    window.addEventListener("cardlink:annotation-saved", saved)
    return () => window.removeEventListener("cardlink:annotation-saved", saved)
  }, [detail.record.recordId, reloadDetail])
  useEffect(() => {
    setTags(manualTagsOf(detail.record))
  }, [detail.record.recordId, detailTagSignature])
  useEffect(() => {
    setView("question")
    setAnswerIndex(0)
    setTagPickerOpen(false)
    setNewTag("")
    setRemoveArmed(false)
    setDeleteTagTarget("")
    setLevelNotice("")
  }, [detail.record.recordId])
  useEffect(() => {
    if (!tagPickerOpen) return undefined
    const close = event => {
      if (!tagPickerRef.current?.contains(event.target) && !tagMenuRef.current?.contains(event.target)) setTagPickerOpen(false)
    }
    document.addEventListener("pointerdown", close, true)
    return () => document.removeEventListener("pointerdown", close, true)
  }, [tagPickerOpen])
  const answer = answerDetail?.answers?.[Math.min(answerIndex, Math.max(0, answerDetail.answers.length - 1))]
  const reviewStatus = detail.record.reviewCompleted ? "已结束" : reviewCountdown(detail.record.nextReviewAt).replace(/^下次复习/, "").replace(/剩余\s*/, "").replace(/\s+天/, "天").replace(/今天到期|今日到期/, "已到期")
  // 剩余天数芯片按到期状态取对应的三档色系（与等级控件同一色盘）
  const dueTone = detail.record.reviewCompleted ? "isCompleted"
    : reviewStatus === "已到期" ? "isOverdue" : "isUpcoming"
  async function applyTags(next) {
    setTags(next)
    // action 对 setMistakeCategory 做就地补丁（列表、详情与标签集合同步更新），
    // 不再整页刷新；写入失败时 action 内部的静默重载会回滚列表与详情。
    await action("setMistakeCategory", { recordId: detail.record.recordId, categories: next })
  }
  function toggleTag(tag) {
    applyTags(tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag])
  }
  function createTag() {
    const clean = newTag.replace(/[\n\r#]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40)
    if (!clean) return
    setNewTag("")
    applyTags(tags.includes(clean) ? tags : [...tags, clean])
  }
  async function confirmDeleteTag() {
    if (!deleteTagTarget) return
    const result = await action("deleteMistakeTag", { tag: deleteTagTarget })
    if (!result) return
    setTags(current => current.filter(item => item !== deleteTagTarget))
    setDeleteTagTarget("")
    await reloadDetail()
  }
  async function updateLevel(event) {
    const nextLevel = Number(event.target.value)
    const previousLevel = detail.record.level
    const result = await action("changeMistakeLevel", { recordId: detail.record.recordId, level: nextLevel })
    if (!result) return
    setLevelNotice(nextLevel === previousLevel
      ? `已确认为「${levelNames[nextLevel]}」；本次复测完成，下次复测时间为 ${formatDate(result.nextReviewAt)}。`
      : `等级已改为「${levelNames[nextLevel]}」；复习序列已重置，下次复测时间为 ${formatDate(result.nextReviewAt)}。`)
    await reloadDetail()
  }
  async function toggleFavorite() {
    if (favoriteBusy) return
    setFavoriteBusy(true)
    try {
      await action("setMistakeFavorite", {
        recordId: detail.record.recordId,
        favorite: detail.record.favorite !== true
      })
    } finally {
      setFavoriteBusy(false)
    }
  }
  async function remove() {
    if (!removeArmed) return setRemoveArmed(true)
    const result = await action("removeMistake", { recordId: detail.record.recordId })
    if (result?.removed) onRemoved()
  }
  async function openHandwriting() {
    if (!detail.handwritingAvailable) {
      showLocateHint?.("当前使用经典面板，整卡手写未启用。请先在设置 → 关于插件开启“场景面板与批注手写”；需软件5.0.0及以上并启用场景模式，启用后重新打开窗口生效。")
      return
    }
    if (handwritingPending.current) return
    handwritingPending.current = true
    setHandwritingBusy(true)
    try { await action("openMistakeHandwriting", { recordId: detail.record.recordId }, false) }
    finally { handwritingPending.current = false; setHandwritingBusy(false) }
  }
  return <div className="detail">
    <div className="detailHeader"><div className="detailHeadingBlock">
      <div className="preview-detail-source-row"><small className="preview-studyset-name">{detail.record.sourceNotebookTitle}</small><span className="preview-detail-source-path">{(detail.record.sourcePathTitles || []).join(" › ") || "脑图根节点"}</span><span className="detailAddedDate" title={`添加于 ${formatDate(detail.record.createdAt)}`}>{formatDate(detail.record.createdAt)}</span></div>
      <div className="preview-detail-title-row"><h2>{detail.record.sourceTitle}</h2>
        {/* 大胶囊：等级 | 剩余天数，竖线分隔、两侧各按各的状态上色；透明 select 覆盖等级半区用于改等级 */}
        <div className="detailStatusCard">
          <span className={`detailLevelChip level level${detail.record.level}`} title={fsrsActive ? "固定曲线历史等级（只读）；FSRS 反馈见待复习" : "点击调整等级"}>
            {levelNames[detail.record.level]}
            <select className={`previewLevelSelect preview-level-${detail.record.level}`} disabled={fsrsActive} value={detail.record.level} onChange={updateLevel} aria-label="修改错题等级">{levelNames.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
          </span>
          <span className="detailStatusDivider" aria-hidden="true" />
          <button type="button" className={`detailDueChip ${dueTone}`} onClick={() => onReview?.(detail.record.recordId)} title={fsrsActive ? "打开该题的 FSRS 复习记录" : "查看该题复习记录"}>{fsrsActive ? "FSRS 复习" : reviewStatus}</button>
        </div>
    <div ref={tagPickerRef} className={`detailTagPicker detailTagBar ${tagPickerOpen ? "open" : ""}`}>
      <div className="detailTagStrip">
        <button ref={tagTriggerRef} type="button" className="detailTagBarTrigger" aria-label="编辑自定义标签" onClick={() => setTagPickerOpen(value => !value)} aria-expanded={tagPickerOpen} title={[...reasonTags, ...tags].map(tag => `#${tag}`).join(" ") || "添加自定义标签"}>
          {reasonTags.map(tag => <em key={tag}>#{tag}</em>)}{tags.map(tag => <em key={tag}>#{tag}</em>)}<DetailMorphIcon icon={Plus} target={ChevronDown} active={tagPickerOpen} />
        </button>
        {!!detail.linkedQuestions?.length && <div className="detailLinkedQuestions" role="group" aria-label="链接题目">
          {detail.linkedQuestions.map(({ noteId, title, recordId }) => recordId
            ? <a key={noteId} className="detailLinkedQuestion" href={`#mistake=${encodeURIComponent(recordId)}`} title={title} onClick={event => {
              if (!onOpenLinkedQuestion || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              setTagPickerOpen(false)
              onOpenLinkedQuestion(recordId)
            }}>{title}</a>
            : <span key={noteId} className="detailLinkedQuestion" title={`${title}（未收入错题本）`}>{title}</span>)}
        </div>}
      </div>
      {tagPickerOpen && tagMenuPos && createPortal(<div className="detailCategoryMenu" ref={tagMenuRef} style={POPOVER_ABSOLUTE(tagMenuPos)}><strong>自定义标签</strong><div className="detailCategoryOptions">{(customCategories || []).length ? (customCategories || []).map(tag => <div className="detailTagOptionRow" key={tag}><button type="button" role="checkbox" aria-checked={tags.includes(tag)} data-tag={tag} className={`detailTagOption ${tags.includes(tag) ? "checked" : ""}`} onClick={() => toggleTag(tag)}><i className="detailTagCheck" aria-hidden="true">{tags.includes(tag) ? "✓" : ""}</i><span>#{tag}</span></button><button type="button" className="detailTagDelete" title={`删除标签 #${tag}`} aria-label={`删除标签 ${tag}`} onClick={event => { event.stopPropagation(); setDeleteTagTarget(tag) }}><Icon name="trash" /></button></div>) : <small>暂无标签</small>}</div><div className="detailCategoryCreate"><input value={newTag} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") createTag() }} placeholder="新建标签" /><button type="button" onClick={createTag} disabled={!newTag.trim()}>新建</button></div></div>, document.body)}
    </div>
      </div>
    </div>
    </div>
    {levelNotice && <div className="levelChangeNotice" role="status" aria-live="polite">{levelNotice}</div>}
    <div className="detailStage" ref={bar.stageRef}>
      <div className="cardFrame">{view === "question" ? <CardPreview key={`${detail.record.recordId}:question`} title="错题原题" noteId={detail.record.sourceNoteId} html={detail.questionHtml} onInteract={() => setTagPickerOpen(false)} /> : deferredAnswers && !answerDetail ? <div role={answerError ? "alert" : "status"} className="empty"><p>{answerError || "正在读取答案…"}</p>{answerError && <button type="button" onClick={() => setAnswerRetry(value => value + 1)}>重试</button>}</div> : answer ? <CardPreview key={`${detail.record.recordId}:answer:${answer.id || answerIndex}`} title="错题答案" noteId={answer.id} html={answer.html} onInteract={() => setTagPickerOpen(false)} /> : answerDetail?.answerStatus === "index-missing" ? <div className="empty"><p>答案索引暂不可用</p><button type="button" onClick={() => { if (deferredAnswers) { setAnswerResult(null); setAnswerRetry(value => value + 1) } else reloadDetail() }}>处理答案索引</button></div> : <Empty title={answerDetail?.answerStatus === "unbound" ? "尚未绑定答案脑图" : "没有匹配答案"} text="可从经典菜单绑定答案脑图或刷新答案索引。" />}</div>
      {/* 悬浮操作条：停靠预览窗口边缘，可拖动吸附，横竖排布随边切换 */}
      <div ref={bar.controlRef} className={`detailDock ${bar.collapsed ? "isCollapsed" : ""} ${bar.dragging ? "dragging" : ""}`} style={bar.style} {...bar.handlers}>
      <div className={`detailActionBar ${bar.orientation}`} aria-hidden={bar.collapsed} inert={bar.collapsed}>
        <button aria-label="题目" className={view === "question" ? "active" : ""} onClick={() => { setView("question"); setTagPickerOpen(false) }}><DetailMorphIcon icon={FileQuestion} active={view === "question"} /><span className="barText" data-dock-label="question" data-hidden={bar.hiddenLabels.includes("question") || undefined}>题目</span></button>
        <button aria-label="答案" className={view === "answer" ? "active" : ""} onClick={() => { setView("answer"); setTagPickerOpen(false) }}><DetailMorphIcon icon={FileCheck} active={view === "answer"} /><span className="barText" data-dock-label="answer" data-hidden={bar.hiddenLabels.includes("answer") || undefined}>答案{answerDetail?.answers?.length > 1 ? ` (${answerDetail?.answers.length})` : ""}</span></button>
        {view === "answer" && answerDetail?.answers?.length > 1 && <label className="answerVariantControl"><span aria-hidden="true">{answerIndex + 1}</span><select aria-label="选择答案候选" className="answerVariantSelect" value={answerIndex} onChange={event => setAnswerIndex(Number(event.target.value))}>{answerDetail?.answers.map((item, index) => <option key={item.id} value={index}>{item.title} · {item.path}</option>)}</select></label>}
        <FavoriteButton favorite={detail.record.favorite === true} busy={favoriteBusy} onToggle={toggleFavorite} />
        <button type="button" aria-label="手写作答" title={detail.handwritingAvailable ? "直接打开该题的整卡批注面板" : "手写未启用，点击查看原因"} aria-disabled={!detail.handwritingAvailable || handwritingBusy} disabled={handwritingBusy} onClick={openHandwriting}><Icon name="handwrite" /><span className="barText" data-dock-label="handwrite" data-hidden={bar.hiddenLabels.includes("handwrite") || undefined}>手写</span></button>
        {view === "question" ? <LocateButton locateKey={`mistake:${detail.record.recordId}`} className="preview-locate-button" onWaiting={() => showLocateHint("正在切换学习集并定位原题，请稍候…")} onLocate={async () => {
              const located = await action("openSource", { recordId: detail.record.recordId }, false)
              if (located?.locateHint) showLocateHint(located.locateHint)
              return located
            }} settingsIcon ariaLabel="定位原题"><span className="barText" data-dock-label="locate" data-hidden={bar.hiddenLabels.includes("locate") || undefined}>定位</span></LocateButton>
          : <LocateButton locateKey={`mistake-answer:${answer?.id || detail.record.recordId}`} className="preview-locate-button" onWaiting={() => showLocateHint("正在浮窗中定位答案卡片，请稍候…")} onLocate={async () => {
              const located = await action("openMistakeAnswer", { answerNoteId: answer?.id }, false)
              if (located?.locateHint) showLocateHint(located.locateHint)
              return located
            }} settingsIcon ariaLabel="定位答案"><span className="barText" data-dock-label="locate" data-hidden={bar.hiddenLabels.includes("locate") || undefined}>定位</span></LocateButton>}
        <button type="button" className={`detailRemoveMistake ${removeArmed ? "confirming" : ""}`} aria-label={removeArmed ? "再次确认取消错题" : "取消错题"} title={removeArmed ? "再次确认取消错题" : "取消错题"} onClick={remove}><DetailMorphIcon icon={Trash2} active={removeArmed} /><span className="barText" data-dock-label="delete" data-hidden={bar.hiddenLabels.includes("delete") || undefined}>删除</span></button>
        <button type="button" className="detailBarCollapse" aria-label="折叠操作条" onClick={() => bar.setCollapsed(true)}><DetailMorphIcon icon={ChevronUp} target={Wrench} active={bar.collapsed} /></button>
      </div>
      <button type="button" className="detailBarDot" aria-label="展开操作条" aria-hidden={!bar.collapsed} tabIndex={bar.collapsed ? 0 : -1} onClick={() => bar.setCollapsed(false)}><DetailMorphIcon icon={ChevronUp} target={Wrench} active={bar.collapsed} /></button>
      </div>
    </div>
    {deleteTagTarget && createPortal(<div className="tagDeleteConfirmOverlay" role="presentation" onClick={event => event.target === event.currentTarget && setDeleteTagTarget("")}><div className="tagDeleteConfirm" role="dialog" aria-modal="true" aria-labelledby="tag-delete-title"><h3 id="tag-delete-title">删除标签</h3><p>确定删除 <strong>#{deleteTagTarget}</strong> 吗？该标签会从所有错题卡片中移除。</p><div><button type="button" onClick={() => setDeleteTagTarget("")}>取消</button><button type="button" className="danger" onClick={confirmDeleteTag}>删除</button></div></div></div>, document.body)}
  </div>
}

function Empty({ title, text, icon = true }) {
  return <div className="emptyState">{icon && <span><Icon name="search" /></span>}<strong>{title}</strong><small>{text}</small></div>
}

// 弹层经 portal 挂到 body 并用 fixed 坐标锚定触发按钮：侧栏滚动容器与
// 详情面板的 overflow 不再裁剪弹层，毛玻璃悬浮条的 backdrop-filter 也不会
// 把 fixed 变成相对自身定位。align="start" 左对齐（分类/日期），"end" 右对齐（标签菜单）。
function useAnchoredPopover(open, triggerRef, width, align = "start") {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return undefined
    }
    const el = triggerRef.current
    if (!el) return undefined
    function update() {
      const rect = el.getBoundingClientRect()
      const w = Number(width) || rect.width
      const anchor = align === "end" ? rect.right - w : rect.left
      setPos({
        left: Math.max(8, Math.min(anchor, window.innerWidth - w - 8)),
        top: Math.min(rect.bottom + 5, window.innerHeight - 60)
      })
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [open, width, align])
  return pos
}

// portal 弹层打开期间：滚动即关闭，避免弹层与锚点脱节。两种滚动例外：
// ① 弹层自身选项列表的滚动（target 在容器内）——不能关闭，否则下拉无法下滑；
// ② 弹层内输入框聚焦时 iOS 自动滚动露出输入框——不能关闭，否则键盘立即收起。
function useScrollDismiss(open, onClose, containerRef) {
  useEffect(() => {
    if (!open) return undefined
    function onScroll(event) {
      const container = containerRef?.current
      if (container && (container.contains(event.target) || container.contains(document.activeElement))) return
      onClose()
    }
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    return () => document.removeEventListener("scroll", onScroll, { capture: true })
  }, [open, onClose, containerRef])
}

const POPOVER_ABSOLUTE = pos => ({ position: "absolute", left: pos.left, top: pos.top })

function ClipperSettings({ clipper, action }) {
  const [pendingSlot, setPendingSlot] = useState("")
  const [saving, setSaving] = useState(false)
  const toolPrompts = { title: "摘录标题", question: "摘录题目", answer: "摘录答案" }
  const sceneBinding = clipper?.toolBindingMode === "scene"
  const pendingTool = sceneBinding ? "" : pendingSlot
  async function bind(slot) {
    if (saving) return
    if (!sceneBinding && pendingSlot !== slot) {
      setPendingSlot(slot)
      await action("notify", { message: `请选择“${toolPrompts[slot]}”的工具，再点击“确认”绑定。` }, false)
      return
    }
    setSaving(true)
    try {
      const result = await action("recordClipperTool", { slot }, false)
      if (result?.tools?.[slot]) setPendingSlot("")
    } finally { setSaving(false) }
  }
  return <div className="clipSettings">
    <div className="clipSettingHeading"><strong>工具绑定</strong><small role="status" aria-live="polite">{sceneBinding ? "点击对应步骤，从当前场景笔盒选择摘录工具。" : pendingSlot ? `请选择“${toolPrompts[pendingSlot]}”的工具，再次点击“确认”绑定。` : "点击对应步骤，选择工具后再次确认绑定。"}</small></div>
    <div className="clipToolBindings">{[["title", "标题"], ["question", "题目"], ["answer", "答案"]].map(([slot, label]) => <button type="button" key={slot} className={pendingTool === slot ? "confirming" : clipper?.tools?.[slot] ? "bound" : ""} disabled={saving || clipper?.started || (slot === "title" && clipper?.excerptTitle === false) || (slot === "answer" && clipper?.excerptAnswer === false)} onClick={() => bind(slot)} aria-label={pendingTool === slot ? `确认绑定${label}工具` : label + "工具：" + (clipper?.toolLabels?.[slot] || "未绑定")}><span>{pendingTool === slot ? "确认" : label + " | " + (clipper?.toolLabels?.[slot] || "未绑定")}</span></button>)}</div>
    <button type="button" className="clipSettingRow" onClick={() => action("chooseClipperAnswerPosition", null, false)}><span>答案位置</span><span className="clipPosition">子卡片<Icon name="right" /></span></button>
    <button type="button" className="clipSettingRow" onClick={() => { setPendingSlot(""); action("setClipperTitle", { enabled: clipper?.excerptTitle === false }, false) }}><span>摘录标题</span><SvgSwitch checked={clipper?.excerptTitle !== false} label="摘录标题" /></button>
    <button type="button" className="clipSettingRow" onClick={() => { setPendingSlot(""); action("setClipperAnswer", { enabled: clipper?.excerptAnswer === false }, false) }}><span>摘录答案</span><SvgSwitch checked={clipper?.excerptAnswer !== false} label="摘录答案" /></button>
    <button type="button" className="clipSettingRow" disabled={clipper?.started} onClick={() => action("configureClipperTitleFormat", null, false)}><span>标题格式</span><span className="clipPosition">{{ original: "原始标题", prefix: "统一前缀＋标题", mother: "母卡标题＋标题", number: "母卡内自动题号" }[clipper?.titleMode || "original"]}<Icon name="right" /></span></button>
    <p className="clipTitleExample">{clipper?.titleMode === "prefix" ? `示例：${clipper.titlePrefix} · 例题 1` : clipper?.titleMode === "mother" ? "示例：第一章 · 例题 1（需绑定母卡）" : clipper?.titleMode === "number" ? "示例：第1题 · 例题标题；未摘标题则为第1题。各母卡独立续号。" : "保留摘录或手动输入的标题。"}</p>
  </div>
}

export function ReviewFeedbackSettings({ matching, action }) {
  return <SettingsGroup title="待复习设置" tone="purple" items={[
    ["toggle", "卡片评论自动折叠", `题目预览默认展开前 ${matching?.reviewExpandedCommentCount ?? 2} 条`, () => action("chooseReviewCommentCount", null, false)],
    ["toggle", "复习反馈", null, () => action("setPersonalSetting", { key: "reviewCompletionConfetti", value: matching?.reviewCompletionConfetti === false }), <SvgSwitch checked={matching?.reviewCompletionConfetti !== false} label="复习反馈" key="review-completion-confetti" />]
  ]} />
}

function SettingsGroup({ title, items, tone = "accent", disclosure, children }) {
  const [expanded, setExpanded] = useState(false)
  const disclosureId = useId()
  const renderItem = ([icon, name, description, onClick, trailing, checked]) => (
    <button type="button" key={name} disabled={!onClick} className={trailing ? "hasTrailing" : ""} onClick={onClick} role={checked === undefined ? undefined : "switch"} aria-label={checked === undefined ? undefined : name} aria-checked={checked}><i><SFTileIcon name={icon} tone={tone} /></i><span><strong>{name}</strong>{description && <small>{description}</small>}</span>{trailing}</button>
  )
  return <div className="settingsGroup"><h2>{title}</h2><div>
    {items.map(renderItem)}
    {disclosure && <>
      <button type="button" className="hasTrailing" aria-expanded={expanded} aria-controls={disclosureId} onClick={() => setExpanded(value => !value)}>
        <i><SFTileIcon name={disclosure.icon} tone={tone} /></i><span><strong>{disclosure.title}</strong></span><Icon name={expanded ? "up" : "down"} />
      </button>
      <div id={disclosureId} className="settingsDisclosure" hidden={!expanded}>
        {expanded && <>{disclosure.items.map(renderItem)}{disclosure.content}</>}
      </div>
    </>}
  </div>{children}</div>
}

function GlobalAnswerColors({ colors, action }) {
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  async function confirm() {
    setSaving(true)
    try { if (await action("addGlobalAnswerBindingColor")) setAdding(false) } finally { setSaving(false) }
  }
  return <div className="answerBindingColors"><header><strong>全局颜色绑定</strong><span>{adding ? "请在脑图选中一张卡片，再点击对勾。" : "仅作用于子卡片及混合模式。"}</span></header><div>
    {colors.map(color => <button key={color} className="selected" disabled={saving} aria-label={`删除全局颜色 ${color + 1}`} onClick={() => action("setPersonalSetting", { key: "globalQuestionColors", value: colors.filter(v => v !== color) })}><span className="answerBindingColorSwatch" style={{ backgroundColor: cardColorSwatches[color] }} />颜色 {color + 1}<Icon name="close" /></button>)}
    <button className="answerBindingAddColor" aria-label={adding ? "确认全局颜色" : "添加全局颜色"} disabled={saving} onClick={adding ? confirm : () => setAdding(true)}><DetailMorphIcon icon={Plus} target={Check} active={adding} /></button>
    {adding && <button aria-label="取消添加全局颜色" disabled={saving} onClick={() => setAdding(false)}><Icon name="close" /></button>}
  </div></div>
}

function AnswerBindingsManager({ rows, colors, action }) {
  const [open, setOpen] = useState(false)
  const matchingHelpRef = useRef(null)
  return <section className="answerBindingsManager">
    <button type="button" className="answerBindingsHeading" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span><strong>答案绑定管理</strong><small>管理每个题目脑图的答案来源与题目颜色</small></span><b>{rows.length} 组</b><Icon name={open ? "up" : "down"} />
    </button>
    {open && <div className="answerBindingsList">
      <GlobalAnswerColors colors={colors} action={action} />
      {!!rows.length && <div className="answerBindingsColumns"><span>学习集名称</span><span>题目脑图名称</span><span className="answerMatchingLabel">答案匹配方式<button type="button" className="answerMatchingHelp" aria-label="答案匹配方式说明" title="答案匹配方式说明" onClick={() => matchingHelpRef.current?.showModal()}><Icon name="info" /></button></span><span>答案脑图名称</span><span>操作</span></div>}
      {!rows.length && <p className="answerBindingsEmpty">尚未绑定答案。先在当前脑图选择一张卡片，再使用上方的绑定入口。</p>}
      {rows.map(row => <AnswerBindingRow key={row.key} row={row} globalColors={colors} action={action} />)}
    </div>}
    <dialog ref={matchingHelpRef} className="answerMatchingDialog" aria-labelledby="answer-matching-help-title">
      <h2 id="answer-matching-help-title">答案匹配方式说明</h2>
      <h3>答案脑图</h3>
      <p>适用于题目和答案分别整理在不同的脑图中的情况。绑定答案脑图后，插件会按照你设置的匹配规则，为题目查找对应答案。题目脑图默认全部卡片为题目，无需绑定颜色。</p>
      <h3>子卡片</h3>
      <p>题目和答案放在同一张脑图中，直接放在题目下面的子卡片就是答案，无需按标题匹配。需要先添加题目卡片颜色，插件才会识别哪些卡片是题目。</p>
      <p>这种方式支持做题时遮住子卡片答案，查看答案时可选择揭开遮盖或打开答案窗口。</p>
      <form method="dialog"><button type="submit" autoFocus>知道了</button></form>
    </dialog>
  </section>
}

function AnswerBindingRow({ row, globalColors = [], action }) {
  const answerMindMapOnly = row.selectionMode !== "mixed" && row.designatedAnswer !== "subcard"
  const [filterOpen, setFilterOpen] = useState(false)
  const [colorNotice, setColorNotice] = useState(false)
  const [addingColor, setAddingColor] = useState(false)
  const [colorMismatch, setColorMismatch] = useState(false)
  const [colorSaving, setColorSaving] = useState(false)
  const [removeArmed, setRemoveArmed] = useState(false)
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    setFilterOpen(false)
    setAddingColor(false)
    setColorMismatch(false)
    setColorNotice(false)
  }, [answerMindMapOnly])
  useEffect(() => {
    if (!removeArmed) return
    const timer = setTimeout(() => setRemoveArmed(false), 15000)
    return () => clearTimeout(timer)
  }, [removeArmed])
  async function remove() {
    if (!removeArmed) return setRemoveArmed(true)
    if (removing) return
    setRemoving(true)
    try {
      const result = await action("deleteManagedAnswerBinding", { key: row.key })
      if (!result?.deleted) setRemoveArmed(false)
    } finally { setRemoving(false) }
  }
  async function toggleFilter() {
    if (answerMindMapOnly) { setColorNotice(true); return }
    setFilterOpen(value => !value)
  }
  async function removeColor(color) {
    if (colorSaving) return
    setColorSaving(true)
    try {
      await action("updateManagedAnswerBinding", { key: row.key, changes: {
        questionColors: row.questionColors.filter(value => value !== color)
      } })
    } finally { setColorSaving(false) }
  }
  async function confirmAddColor() {
    if (colorSaving) return
    setColorSaving(true)
    try {
      const result = await action("addManagedAnswerBindingColor", { key: row.key })
      setColorMismatch(result?.mismatch === true)
      if (result && !result.mismatch) setAddingColor(false)
    } finally { setColorSaving(false) }
  }
  const designated = row.selectionMode === "designated"
  const mindMapSource = !designated || row.designatedAnswer === "mindmap"
  return <article className="answerBindingRow">
    <div className="answerBindingMain">
      <strong className="answerBindingName" title={row.notebookTitle}>{row.notebookTitle}</strong>
      <strong className="answerBindingName" title={row.sourceTitle}>{row.sourceTitle}</strong>
      <div className={`answerBindingSwitch ${designated ? "isDesignated" : ""}`} aria-label="答案匹配方式">
        <i className="answerBindingMainSlider" aria-hidden="true" />
        <button type="button" className={!designated ? "active" : ""} aria-pressed={!designated} onClick={() => row.hasAnswerMindMap ? action("updateManagedAnswerBinding", { key: row.key, changes: { selectionMode: "mixed" } }) : action("chooseManagedAnswerMindMap", { key: row.key, activateMixed: true })}>混合</button>
        <div className="answerBindingDesignated">
          <button type="button" className="answerBindingDesignatedLabel" aria-pressed={designated} tabIndex={designated ? -1 : 0} onClick={() => action("updateManagedAnswerBinding", { key: row.key, changes: { selectionMode: "designated" } })}>指定</button>
          <div className="answerBindingSubSwitch" aria-hidden={!designated}>
            <i className={row.designatedAnswer === "subcard" ? "subcard" : ""} aria-hidden="true" />
            <button type="button" className={row.designatedAnswer === "mindmap" ? "active" : ""} tabIndex={designated ? 0 : -1} aria-pressed={designated && row.designatedAnswer === "mindmap"} onClick={() => row.hasAnswerMindMap ? action("updateManagedAnswerBinding", { key: row.key, changes: { designatedAnswer: "mindmap" } }) : action("chooseManagedAnswerMindMap", { key: row.key })}>答案脑图</button>
            <button type="button" className={row.designatedAnswer === "subcard" ? "active" : ""} tabIndex={designated ? 0 : -1} aria-pressed={designated && row.designatedAnswer === "subcard"} onClick={() => action("updateManagedAnswerBinding", { key: row.key, changes: { designatedAnswer: "subcard" } })}>子卡片</button>
          </div>
        </div>
      </div>
      {mindMapSource ? <button type="button" className="answerBindingTarget" title="点击更换答案脑图" onClick={() => action("chooseManagedAnswerMindMap", { key: row.key, activateMixed: !row.hasAnswerMindMap && !designated })}>{row.hasAnswerMindMap ? row.answerTitle : "选择答案脑图"}</button> : <span className="answerBindingTargetEmpty">—</span>}
      <span className="answerBindingActions">
        <button type="button" aria-label={filterOpen ? "收起题目筛选" : "筛选题目"} title={filterOpen ? "收起题目筛选" : "筛选题目"} aria-expanded={filterOpen} onClick={toggleFilter}><DetailMorphIcon icon={ListFilter} target={ChevronUp} active={filterOpen} /></button>
        <button type="button" aria-label="刷新索引" title="刷新索引" onClick={() => action("refreshManagedAnswerBinding", { key: row.key })}><DetailMorphIcon icon={RefreshCw} /></button>
        <button type="button" className={`danger ${removeArmed ? "confirming" : ""}`} aria-label={removeArmed ? "再次点击删除绑定" : "删除绑定"} title={removeArmed ? "再次点击删除绑定" : "删除绑定"} disabled={removing} onClick={remove}><DetailMorphIcon icon={Trash2} target={Check} active={removeArmed} /></button>
      </span>
    </div>
    {(!designated || row.designatedAnswer === "subcard") && !row.questionColors.length && !globalColors.length && <p className="answerBindingColorHint">子卡片答案匹配需要先绑定题目卡片颜色。<button type="button" onClick={() => { setFilterOpen(true); setAddingColor(true) }}>绑定题目颜色</button></p>}
    {answerMindMapOnly && colorNotice && <p className="answerBindingColorHint" role="status">答案脑图无需绑定颜色</p>}
    {!answerMindMapOnly && filterOpen && <div className="answerBindingColors"><header><strong>题目卡片颜色</strong>{addingColor && <span>请在当前脑图选中一张题目卡片，再点击对勾。</span>}</header>
      {addingColor && colorMismatch && <p className="answerBindingColorHint" role="alert">所选卡片不在当前绑定的{row.sourceTitle === "整个学习集" ? "学习集" : "题目脑图"}「{row.sourceTitle === "整个学习集" ? row.notebookTitle : row.sourceTitle}」中，请重新选择。</p>}
      <div>{row.questionColors.map(color => <button key={color} type="button" className="selected" aria-label={`删除颜色 ${color + 1}`} title={`删除颜色 ${color + 1}`} disabled={colorSaving} onClick={() => removeColor(color)}><span className="answerBindingColorSwatch" style={{ backgroundColor: cardColorSwatches[color] ?? "#d8dee8" }} aria-hidden="true" /><span>颜色 {color + 1}</span><Icon name="close" /></button>)}
        <button type="button" className="answerBindingAddColor" aria-label={addingColor ? "确认添加所选卡片颜色" : "添加颜色"} title={addingColor ? "确认添加" : "添加颜色"} onClick={addingColor ? confirmAddColor : () => setAddingColor(true)} disabled={colorSaving}><DetailMorphIcon icon={Plus} target={Check} active={addingColor} /></button>
        {addingColor && <button type="button" className="answerBindingCancelColor" aria-label="取消添加颜色" title="取消" onClick={() => { setAddingColor(false); setColorMismatch(false) }} disabled={colorSaving}><Icon name="close" /></button>}</div>
    </div>}
  </article>
}

function RegexMatchingSettings({ matching, action }) {
  const [questionPattern, setQuestionPattern] = useState("")
  const [answerPattern, setAnswerPattern] = useState("")
  const [saved, setSaved] = useState("")

  useEffect(() => {
    setQuestionPattern(matching?.regexRules?.questionPattern || "")
    setAnswerPattern(matching?.regexRules?.answerPattern || "")
  }, [matching?.regexRules?.questionPattern, matching?.regexRules?.answerPattern])

  function applyPreset(kind) {
    const pattern = kind === "number"
      ? String.raw`(?:第\s*)?(\d+)\s*(?:题|[.、])?`
      : String.raw`(?:第\s*)?(\d+)\s*(?:章|[-－—])\D*?(?:第\s*)?(\d+)\s*(?:题)?`
    setQuestionPattern(pattern)
    setAnswerPattern(pattern)
    setSaved("")
  }

  async function save() {
    setSaved("")
    const result = await action("saveRegexMatchingRules", {
      questionPattern,
      answerPattern
    })
    if (result?.saved) setSaved("规则已保存，正则匹配模式已独立启用。")
  }

  return <section className="regexSettings">
    <header>
      <span><strong>正则规则匹配</strong><small>独立匹配方式，不参与完整标题或章节顺序的查找优先级</small></span>
      <b className={matching?.mode === "regex" ? "active" : ""}>{matching?.mode === "regex" ? "已启用" : "未启用"}</b>
    </header>
    <div className="regexPresets">
      <button onClick={() => applyPreset("number")}>仅题号预设</button>
      <button onClick={() => applyPreset("chapter-number")}>章节＋题号预设</button>
    </div>
    <label>
      <span>题目匹配规则</span>
      <input value={questionPattern} onChange={event => { setQuestionPattern(event.target.value); setSaved("") }} placeholder={String.raw`例如：(?:第\s*)?(\d+)\s*题`} />
    </label>
    <label>
      <span>答案匹配规则</span>
      <input value={answerPattern} onChange={event => { setAnswerPattern(event.target.value); setSaved("") }} placeholder={String.raw`例如：答案\s*(\d+)`} />
    </label>
    <p>规则无需填写 <code>/.../</code> 分隔符。存在捕获组时按捕获组顺序生成匹配键；没有捕获组时使用完整匹配内容。题目键与答案键完全相同时才会匹配。</p>
    <button className="regexSave" disabled={!questionPattern.trim() || !answerPattern.trim()} onClick={save}>保存规则并启用正则匹配</button>
    {saved && <small className="regexSaved">{saved}</small>}
  </section>
}

function MistakeLevelGuide({ reviewCurves, action }) {
  const normalized = defaultReviewCurves.map((fallback, level) =>
    fallback.map((days, index) => Number(reviewCurves?.[level]?.[index]) || days))
  const [curves, setCurves] = useState(normalized)
  const [saved, setSaved] = useState("")
  const [editing, setEditing] = useState(false)
  useEffect(() => { setCurves(normalized) }, [JSON.stringify(reviewCurves)])

  function update(level, index, value) {
    const next = curves.map(curve => [...curve])
    next[level][index] = value
    setCurves(next)
    setSaved("")
  }

  async function save() {
    const valid = curves.map((curve, level) => curve.map((value, index) => {
      const days = Number(value)
      return Number.isInteger(days) && days >= 1 && days <= 3650 ? days : defaultReviewCurves[level][index]
    }))
    const result = await action("saveMistakeReviewCurves", { curves: valid })
    if (result) {
      setCurves(valid)
      setSaved("已保存；将在新标记或完成复习后生效")
      setEditing(false)
    }
  }

  return <section className="mistakeLevelGuide">
    <header><h2>错题分类说明</h2><p>可自定义 1–3650 天；复测结果决定下一次间隔。</p></header>
    <div>{levelNames.map((name, level) => <article key={name}>
      <span className={`level level${level}`}>{name}</span>
      <span><strong>{levelExplanations[level]}</strong><small>{levelReviewNotes[level]}</small></span>
      {editing ? <span className="reviewDayEditor">{curves[level].map((days, index) => <label key={index}>
        <small>{index === 0 ? "首次" : "后续"}</small>
        <input type="number" min="1" max="3650" step="1" value={days} onChange={event => update(level, index, event.target.value)} />
        <em>天</em>
      </label>)}</span> : <span className="reviewDaySummary">首次 <b>{curves[level][0]}</b> 天{curves[level].length > 1 && <> · 后续 <b>{curves[level].slice(1).join("、")}</b> 天</>}</span>}
    </article>)}</div>
    <footer><small>{saved || "首次标记为“不会”或“不熟”时，从首个间隔进入复测计划。"}</small><button onClick={() => editing ? save() : setEditing(true)}>{editing ? "保存复习天数" : "编辑复习天数"}</button></footer>
  </section>
}

// D3：极简 Markdown 预览渲染（标题/加粗/斜体/行内码/列表/引用/分隔线）。
// 图片以占位标注（真实图片在导出时嵌入），完整样式以导出产物为准。
function renderMarkdownPreview(markdown) {
  const RE = (pattern, flags) => new RegExp(pattern, flags)
  const NL = String.fromCharCode(92) + "r?" + String.fromCharCode(92) + "n"
  const inline = text => escapeHtml(text)
    .replace(RE("`([^`]+)`"), "<code>$1</code>")
    .replace(RE("[*][*]([^*]+)[*][*]"), "<strong>$1</strong>")
    .replace(RE("[*]([^*]+)[*]"), "<em>$1</em>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<span class="mdImageNote">[图片：$1]</span>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
  const lines = String(markdown || "").split(RE(NL))
  const out = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    const closeList = () => { if (inList) { out.push("</ul>"); inList = false } }
    if (RE("^- ").test(line)) {
      if (!inList) { out.push("<ul>"); inList = true }
      out.push("<li>" + inline(line.replace(RE("^- "), "")) + "</li>")
      continue
    }
    closeList()
    if (RE("^#{1,4} ").test(line)) {
      const level = line.match(RE("^#+"))[0].length
      const text = line.replace(RE("^#+ "), "")
      out.push("<h" + (level + 1) + ">" + inline(text) + "</h" + (level + 1) + ">")
      continue
    }
    if (RE("^---$").test(line.trim())) { out.push("<hr />"); continue }
    if (RE("^> ").test(line)) { out.push("<blockquote>" + inline(line.replace(RE("^> "), "")) + "</blockquote>"); continue }
    if (line.trim()) out.push("<p>" + inline(line) + "</p>")
  }
  if (inList) out.push("</ul>")
  return out.join(String.fromCharCode(10))
}

function ExportSelect({ value, onChange, children, "aria-label": ariaLabel }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const options = React.Children.toArray(children).filter(React.isValidElement)
  const optionValue = option => String(option.props.value ?? option.props.children)
  const current = options.find(option => optionValue(option) === String(value))
  useEffect(() => {
    if (!open) return
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false) }
    document.addEventListener("pointerdown", close, true)
    return () => { document.removeEventListener("pointerdown", close, true) }
  }, [open])
  return <div className="exportSelect" ref={ref} onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); ref.current?.querySelector("button")?.focus() }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const index = options.findIndex(option => optionValue(option) === String(value))
      const option = options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]
      if (option) onChange({ target: { value: optionValue(option) } })
    }
  }}><button type="button" className="exportSelectTrigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>{current?.props.children}<Icon name="down" /></button>{open && <div className="exportSelectMenu" role="listbox">{options.map(option => <button type="button" role="option" aria-selected={optionValue(option) === String(value)} key={optionValue(option)} onClick={() => { onChange({ target: { value: optionValue(option) } }); setOpen(false); ref.current?.querySelector("button")?.focus() }}>{option.props.children}</button>)}</div>}</div>
}

function ExportSection({ step, title, description, trailing, children, className = "" }) {
  return <section className={`exportSection ${className}`}><header><span className="exportStep" aria-hidden="true">{step}</span><span><h2>{title}</h2><p>{description}</p></span>{trailing}</header><div className="exportSectionBody">{children}</div></section>
}

function ExportSegmented({ label, value, options, onChange }) {
  return <div className="exportSegmented" role="group" aria-label={label}>{options.map(option => <button type="button" key={option.value} className={value === option.value ? "selected" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</button>)}</div>
}

function MistakeExport({ allRecords, action, onBack, initialRecordIds = [] }) {
  const exportPageRef = useRef(null)
  const [format, setFormat] = useState("pdf")
  const [pdfTask, setPdfTask] = useState(null)
  const pdfTaskPollRef = useRef(0)
  const exportCancelRequestedRef = useRef(false)
  const [filename, setFilename] = useState(`MN4错题导出-${new Date().toISOString().slice(0, 10)}`)
  const [include, setInclude] = useState({ question: true, answer: true, source: true, review: false, handwriting: false, comments: false })
  const [reviewDetail, setReviewDetail] = useState("summary")
  const [result, setResult] = useState("")
  const [answerLayout, setAnswerLayout] = useState("after-each")
  const [pageLayout, setPageLayout] = useState("auto")
  const [actualPreview, setActualPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [stoppingExport, setStoppingExport] = useState(false)
  const [reviewStatusFilter, setReviewStatusFilter] = useState([])
  const [createdFilter, setCreatedFilter] = useState([])
  const [tagFilter, setTagFilter] = useState([])
  const [sortOrder, setSortOrder] = useState("current")
  const [exportQuery, setExportQuery] = useState("")
  const [exportLevel, setExportLevel] = useState([])
  useEffect(() => {
    if (exportPageRef.current) exportPageRef.current.scrollTop = 0
  }, [])
  const initialRecordSignature = Array.isArray(initialRecordIds) ? initialRecordIds.join("\u001f") : ""
  const hasInitialRecords = Boolean(initialRecordSignature)
  const initialRecordSet = useMemo(() => new Set(Array.isArray(initialRecordIds) ? initialRecordIds : []), [initialRecordSignature])
  const scopedRecords = useMemo(() => hasInitialRecords ? allRecords.filter(item => initialRecordSet.has(item.recordId)) : allRecords, [allRecords, initialRecordSignature])
  const mindMaps = useMemo(() => buildMindMapOptions(scopedRecords), [scopedRecords])
  const [selectedMapKeys, setSelectedMapKeys] = useState(() => hasInitialRecords ? mindMaps.map(map => map.key) : [])
  const mindMapSignature = mindMaps.map(map => map.key).join("\u001f")
  useEffect(() => {
    const available = mindMaps.map(map => map.key)
    setSelectedMapKeys(current => {
      const kept = current.filter(key => available.includes(key))
      return kept.length || !hasInitialRecords ? kept : available
    })
  }, [mindMapSignature, initialRecordSignature])
  const effectiveMapKeys = selectedMapKeys
  const effectiveMapSet = useMemo(() => new Set(effectiveMapKeys), [effectiveMapKeys.join("\u001f")])
  // 导出题目只由本页筛选条件控制，失效原卡片始终排除。
  const nowDate = new Date()
  const startToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const endToday = startToday + 86400000
  const availableRecords = useMemo(() => scopedRecords.filter(item => item.noteAvailable !== false), [scopedRecords])
  const invalidCount = scopedRecords.length - availableRecords.length
  const tagOptions = useMemo(() => Array.from(new Set(scopedRecords.flatMap(filterableMistakeTags).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN")), [scopedRecords])
  const exportCandidates = useMemo(() => {
    const filtered = availableRecords.filter(item => effectiveMapSet.has(sourceInsightKey(item)) && matchesExportFilters(item, {
      levels: exportLevel, statuses: reviewStatusFilter, created: createdFilter, tags: tagFilter
    }, startToday)).filter(item => {
    const needle = normalizeSearch(exportQuery)
    return !needle || normalizeSearch([item.sourceTitle, item.sourceNotebookTitle, ...(item.sourcePathTitles || []), ...filterableMistakeTags(item)].join(" ")).includes(needle)
    })
    if (sortOrder === "current") return filtered
    return [...filtered].sort((a, b) => {
      if (sortOrder === "created-desc") return String(b.createdAt).localeCompare(String(a.createdAt))
      if (sortOrder === "due-asc") return new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime()
      if (sortOrder === "level") return Number(a.level) - Number(b.level) || String(a.sourceTitle).localeCompare(String(b.sourceTitle), "zh-CN")
      if (sortOrder === "source") return `${a.sourceNotebookTitle} ${a.categoryLabel}`.localeCompare(`${b.sourceNotebookTitle} ${b.categoryLabel}`, "zh-CN")
      return String(a.recordId).localeCompare(String(b.recordId))
    })
  }, [availableRecords, reviewStatusFilter, createdFilter, tagFilter, sortOrder, startToday, endToday, exportLevel, exportQuery, mindMapSignature, effectiveMapKeys.join("\u001f")])
  const selected = exportCandidates

  const mapFilterActive = hasInitialRecords ? effectiveMapKeys.length !== mindMaps.length : effectiveMapKeys.length > 0
  const activeFilterCount = [reviewStatusFilter.length > 0, createdFilter.length > 0, tagFilter.length > 0, exportLevel.length > 0, mapFilterActive, Boolean(exportQuery.trim())].filter(Boolean).length
  const filterSummary = [
    ...reviewStatusFilter.map(value => ({ today: "今日到期", overdue: "已逾期", upcoming: "未来复习", completed: "已结束" })[value]),
    ...createdFilter.map(value => ({ today: "今天添加", 7: "最近 7 天", 30: "最近 30 天" })[value]),
    ...exportLevel.map(value => levelNames[Number(value)]),
    ...tagFilter.map(value => value === "untagged" ? "无标签" : `#${value}`),
    effectiveMapKeys.length !== mindMaps.length ? `${effectiveMapKeys.length} 个脑图` : "",
    exportQuery.trim() ? `“${exportQuery.trim()}”` : ""
  ].filter(Boolean)

  function estimatePages() {
    if (!selected.length) return 0
    const perPage = pageLayout === "one-per-page" ? 1 : pageLayout === "two-per-page" ? 2 : pageLayout === "three-per-page" ? 3 : 0
    if (!perPage) {
      const pages = Math.ceil(selected.length / (include.answer && answerLayout === "after-each" ? 5 : 10))
      return include.answer && answerLayout === "end" ? pages + Math.ceil(selected.length / 20) : pages
    }
    let pages = Math.ceil(selected.length / perPage)
    if (include.answer) pages += Math.ceil(selected.length / 3)
    return pages
  }
  const toggle = key => setInclude(current => ({ ...current, [key]: !current[key] }))

  const previewSignature = JSON.stringify({ format, recordIds: selected.map(item => item.recordId), answerLayout, pageLayout, reviewDetail, include })
  const previewSignatureRef = useRef(previewSignature)
  previewSignatureRef.current = previewSignature
  useEffect(() => setActualPreview(null), [previewSignature])

  function exportPayload() {
    return { format, filename, recordIds: selected.map(item => item.recordId), answerLayout, pageLayout, reviewDetail, include, filters: { reviewStatusFilter, createdFilter, tagFilter, sortOrder, exportQuery, exportLevel, selectedMapKeys } }
  }

  async function runPreview() {
    const signature = previewSignatureRef.current
    setResult("")
    setPreviewLoading(true)
    try {
      const payload = { ...exportPayload(), previewLimit: 3 }
      const response = await action("previewMistakeExport", payload, false)
      // 发起后筛选/设置又变过：过期响应直接丢弃，不允许旧预览覆盖新设置
      if (previewSignatureRef.current !== signature) return
      if (response?.pdfUrl || response?.html || response?.markdown) {
        setActualPreview(response)
        if (response?.truncated) setResult(`快速预览仅渲染前 ${response.previewCount} 题（共 ${response.count} 道）；全部题目请使用「导出文件」。`)
      }
    } finally {
      setPreviewLoading(false)
    }
  }

  // PDF 导出任务式：受理后轮询进度，前端 30s 超时不再掐断长任务
  const taskActive = pdfTask && (pdfTask.status === "preparing" || pdfTask.status === "rendering" || pdfTask.status === "saving")

  function pollPdfTask(id) {
    const token = ++pdfTaskPollRef.current
    let failures = 0
    const tick = async () => {
      if (token !== pdfTaskPollRef.current) return
      let status
      try {
        // 直连桥接：action() 会吞错返回 undefined，桥接瞬时错误会被误判成任务消失
        status = await MNBridge.send("pdfTaskStatus", { id })
        failures = 0
      } catch {
        failures += 1
        if (failures < 4) { setTimeout(tick, 2500); return }
        setResult("暂时无法获取导出任务状态，正在重试；本次配置保持锁定")
        setTimeout(tick, 5000)
        return
      }
      if (token !== pdfTaskPollRef.current) return
      if (!status?.exists) { setPdfTask(null); return }
      setPdfTask(current => ({ ...(current || { id }), status: status.status, progress: status.progress, pages: status.pages, stage: status.stage, completed: status.completed, total: status.total, snapshot: status.snapshot, error: status.error }))
      if ((status.status === "generated" || status.status === "saved")) { setResult(`PDF 已生成（${status.pages || "?"} 页），已打开系统保存面板`); setPdfTask(null); return }
      if (status.status === "error") { setResult(`PDF 生成失败：${status.error || "未知错误"}`); setPdfTask(null); return }
      if (status.status === "cancelled") { setResult("已取消导出"); setPdfTask(null); return }
      setTimeout(tick, 1500)
    }
    void tick()
  }

  async function cancelPdfTask() {
    exportCancelRequestedRef.current = true
    setStoppingExport(true)
    if (!pdfTask) {
      // 任务受理前：短路原生仍在进行的题目准备/MD 落盘阶段
      try { await MNBridge.send("cancelMistakeExportPreparation") } catch {}
      setStoppingExport(false)
      setResult("已停止导出")
      return
    }
    pdfTaskPollRef.current += 1
    const cancelled = await action("pdfTaskCancel", { id: pdfTask.id }, false)
    if (!cancelled) {
      setStoppingExport(false)
      setResult("停止请求未确认，正在重新读取任务状态")
      pollPdfTask(pdfTask.id)
      return
    }
    setPdfTask(null)
    setStoppingExport(false)
    setResult(cancelled?.cancelled ? "已停止导出" : "任务已结束或已更新，请查看导出结果")
  }

  async function runExport() {
    if (taskActive || previewLoading || exportLoading) return
    exportCancelRequestedRef.current = false
    setStoppingExport(false)
    setResult("")
    setExportLoading(true)
    try {
      const response = await action("exportMistakes", exportPayload(), false)
      if (exportCancelRequestedRef.current && response?.taskAccepted) {
        const cancelled = await action("pdfTaskCancel", { id: response.taskId }, false)
        setStoppingExport(false)
        if (!cancelled) {
          setPdfTask({ id: response.taskId, status: response.status || "preparing", progress: response.progress || 6, snapshot: response.snapshot })
          pollPdfTask(response.taskId)
          setResult("停止请求未确认，正在重新读取任务状态")
          return
        }
        setResult(cancelled.cancelled ? "已停止导出" : "任务已结束或已更新，请查看导出结果")
        return
      }
      if (response?.saved) { setResult(`已打开系统另存面板：${response.filename}（${response.count} 道）`); return }
      if (response?.printCompleted) { setResult(`已生成 ${response.filename}（浏览器预览模拟，共 ${response.count} 道）`); return }
      if (response?.taskAccepted) {
        setPdfTask({ id: response.taskId, status: response.status || "rendering", progress: response.progress || 5, snapshot: response.snapshot })
        pollPdfTask(response.taskId)
      }
    } finally {
      setExportLoading(false)
      if (!exportCancelRequestedRef.current) setStoppingExport(false)
    }
  }

  function resetFilters() {
    setReviewStatusFilter([])
    setCreatedFilter([])
    setTagFilter([])
    setExportLevel([])
    setSelectedMapKeys(hasInitialRecords ? mindMaps.map(map => map.key) : [])
    setExportQuery("")
  }

  // 面板重开后恢复在途任务的状态显示
  useEffect(() => {
    let cancelled = false
    async function resume() {
      try {
        const status = await MNBridge.send("pdfTaskStatus", null)
        if (cancelled) return
        // 预览任务随请求即时终账，不存在在途预览；只恢复真正的导出任务
        if (status?.exists && !status.preview && (status.status === "preparing" || status.status === "rendering" || status.status === "saving")) {
          const snapshot = status.snapshot
          if (snapshot) {
            setFormat(snapshot.format || "pdf"); setFilename(snapshot.filename || "")
            setInclude(snapshot.include || {}); setAnswerLayout(snapshot.answerLayout || "after-each")
            setPageLayout(snapshot.pageLayout || "auto"); setReviewDetail(snapshot.reviewDetail || "summary")
            if (snapshot.filters) {
              const filters = snapshot.filters
              setReviewStatusFilter(filters.reviewStatusFilter || []); setCreatedFilter(filters.createdFilter || [])
              setTagFilter(filters.tagFilter || []); setSortOrder(filters.sortOrder || "current")
              setExportQuery(filters.exportQuery || ""); setExportLevel(filters.exportLevel || [])
              setSelectedMapKeys(filters.selectedMapKeys || [])
            }
          }
          setPdfTask({ id: status.id, status: status.status, progress: status.progress, snapshot: status.snapshot, stage: status.stage, pages: status.pages })
          pollPdfTask(status.id)
        }
      } catch { /* 忽略 */ }
    }
    void resume()
    return () => { cancelled = true; pdfTaskPollRef.current += 1 }
  }, [])

  const contentOptions = [
    ["question", "完整原题", "题干与摘录图片"],
    ["answer", "实时匹配答案", "按当前答案脑图重新匹配"],
    ["source", "来源路径", "学习集、脑图与章节路径"],
    ["review", "复习信息", "等级、时间与复习次数"],
    ["handwriting", "脑图绑定书写"],
    ["comments", "子评论"]
  ]
  const canSubmit = selected.length > 0 && ["question", "answer", "source", "review"].some(key => include[key])
  const pageLabel = { auto: "自动分页 · 卡片 60% 宽度", "one-per-page": "一页一题", "two-per-page": "一页两题", "three-per-page": "一页三题" }[pageLayout]
  const answerLabel = answerLayout === "end" ? "答案文末集中" : "答案紧随题目"
  const exportInProgress = exportLoading || taskActive
  const exportProgress = Math.max(4, Math.min(100, Number(pdfTask?.progress) || (pdfTask?.status === "saving" ? 96 : exportLoading ? 6 : 32)))
  const exportProgressLabel = stoppingExport
    ? "正在停止导出…"
    : pdfTask?.status === "preparing"
      ? "正在准备题目与答案…"
    : pdfTask?.status === "saving"
      ? "PDF 已生成，正在打开保存面板…"
      : taskActive
        ? pdfTask?.stage === "sizing" ? `正在读取图片尺寸 ${pdfTask.completed || 0}/${pdfTask.total || "…"}` : pdfTask?.stage === "planning" ? `正在分页 ${pdfTask.completed || 0}/${pdfTask.total || "…"}` : pdfTask?.stage === "rendering" ? `正在生成 PDF ${pdfTask.completed || 0}/${pdfTask.total || "…"} 页` : pdfTask?.stage === "serializing" ? "正在完成 PDF 文件…" : "正在生成 PDF…"
        : "正在准备导出内容…"

  return <section className="exportPage exportRedesign" ref={exportPageRef}>
    <header className="exportPageHeader"><button type="button" className="exportBackButton" onClick={onBack}><Icon name="left" /> 返回</button><span><h1>导出错题</h1></span></header>
    <div className="exportLayout">
      <div className="exportComposer">
        <fieldset className="exportSettingsLock" disabled={exportInProgress} inert={exportInProgress ? true : undefined}>
        <ExportSection step="1" title="筛选题目" description="符合下列条件的可用错题将全部导出。">
          <ExportFilters query={exportQuery} setQuery={setExportQuery} activeCount={activeFilterCount} onReset={resetFilters} count={selected.length} emptyMaps={!effectiveMapKeys.length}>
            <FilterSection title="错题等级" count={exportLevel.length} open><FilterChoices multiple title="导出错题等级" value={exportLevel} onChange={setExportLevel} options={[{ value: "all", label: "全部等级", count: availableRecords.length }, ...levelNames.map((label, level) => ({ value: String(level), label, color: ["#ef4444", "#f59e0b", "#22c55e"][level], count: availableRecords.filter(item => item.level === level).length }))]} /></FilterSection>
            <FilterSection title="学习集 / 脑图" count={effectiveMapKeys.length} open>{mindMaps.length ? <MindMapMultiSelect options={mindMaps} selectedKeys={effectiveMapKeys} setSelectedKeys={setSelectedMapKeys} title="筛选脑图" allowEmpty emptyLabel="请选择脑图" /> : <small>暂无脑图</small>}</FilterSection>
            <FilterSection title="复习状态" count={reviewStatusFilter.length}><FilterChoices multiple title="导出复习状态" value={reviewStatusFilter} onChange={setReviewStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "today", label: "今日到期" }, { value: "overdue", label: "已逾期" }, { value: "upcoming", label: "未来复习" }, { value: "completed", label: "已结束复习" }]} /></FilterSection>
            <FilterSection title="添加时间" count={createdFilter.length}><FilterChoices multiple title="导出添加时间" value={createdFilter} onChange={setCreatedFilter} options={[{ value: "all", label: "不限时间" }, { value: "today", label: "今天添加" }, { value: "7", label: "最近 7 天" }, { value: "30", label: "最近 30 天" }]} /></FilterSection>
            <FilterSection title="自定义标签" count={tagFilter.length}><FilterChoices multiple title="导出标签" value={tagFilter} onChange={setTagFilter} options={[{ value: "all", label: "全部标签" }, { value: "untagged", label: "无标签" }, ...tagOptions.map(tag => ({ value: tag, label: tag }))]} /></FilterSection>
            <FilterSection title="导出顺序"><FilterChoices title="导出顺序" value={sortOrder} onChange={setSortOrder} options={[{ value: "current", label: "错题本当前顺序" }, { value: "created-desc", label: "最近添加优先" }, { value: "due-asc", label: "最早到期优先" }, { value: "level", label: "按错题等级" }, { value: "source", label: "按来源路径" }]} /></FilterSection>
          </ExportFilters>
        </ExportSection>

        <ExportSection step="2" title="选择内容" description="决定每道题在导出文件中包含什么。">
          <div className="exportContentChoices">{contentOptions.map(([key, label, detail]) => <label key={key} className={include[key] ? "selected" : ""}><AnimatedCheckbox checked={include[key]} label={label} onChange={() => toggle(key)} /><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span></label>)}</div>
          {include.review && <label className="exportInlineSetting"><span><strong>复习信息详细程度</strong><small>概要更适合打印，完整历史适合归档。</small></span><ExportSelect value={reviewDetail} onChange={event => setReviewDetail(event.target.value)}><option value="summary">概要</option><option value="full">完整历史</option></ExportSelect></label>}
          {!["question", "answer", "source", "review"].some(key => include[key]) && <p className="exportInlineWarning">请至少选择一项导出内容。</p>}
        </ExportSection>

        <ExportSection step="3" title="设置文件" description="选择格式；PDF 可继续设置题目密度与答案位置。">
          <div className="formatChoices exportFormatChoices"><button type="button" className={format === "pdf" ? "selected" : ""} aria-pressed={format === "pdf"} onClick={() => setFormat("pdf")}><b>PDF</b><span><strong>打印与练习</strong><small>保留图片、手写和书写区</small></span></button><button type="button" className={format === "md" ? "selected" : ""} aria-pressed={format === "md"} onClick={() => setFormat("md")}><b>MD</b><span><strong>编辑与归档</strong><small>Markdown 正文和 assets 图片</small></span></button></div>
          {format === "pdf" && <div className="exportPdfSettings"><span className="exportControlLabel">每页题目密度</span><ExportSegmented label="每页题目密度" value={pageLayout} onChange={setPageLayout} options={[{ value: "auto", label: "自动", detail: "卡片 60% 宽度" }, { value: "one-per-page", label: "1 题", detail: "留白最多" }, { value: "two-per-page", label: "2 题", detail: "均衡" }, { value: "three-per-page", label: "3 题", detail: "宽松" }]} />{include.answer && <><span className="exportControlLabel">答案位置</span><ExportSegmented label="答案位置" value={answerLayout} onChange={setAnswerLayout} options={[{ value: "after-each", label: "紧随题目", detail: "核对更直接" }, { value: "end", label: "文末集中", detail: "适合整套练习" }]} /></>}</div>}
          <label className="exportFilenameField"><span>文件名</span><div className="filenameInput"><input value={filename} onChange={event => setFilename(event.target.value)} /><b>{format === "md" ? ".zip" : ".pdf"}</b></div></label>
        </ExportSection>

        </fieldset>
        {exportInProgress && <p className="exportResult">本次导出配置已锁定</p>}
        {exportInProgress ? <div className="exportCommitBar exportCommitProgress" role="status" aria-live="polite"><span className="exportProgressCopy"><strong>{exportProgressLabel}</strong><small>{pdfTask?.pages > 0 ? `${pdfTask.pages} 页` : `${pdfTask?.snapshot?.recordIds?.length ?? selected.length} 道题`} · {Math.round(exportProgress)}%</small></span><span className="exportProgressTrack" role="progressbar" aria-label="导出进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(exportProgress)}><i style={{ transform: `scaleX(${exportProgress / 100})` }} /></span><button type="button" className="exportStopButton" onClick={cancelPdfTask} disabled={stoppingExport}>停止导出</button></div> : <div className="exportCommitBar" role="status"><span className="exportCountBadge"><strong>{selected.length}</strong><small>道将导出</small></span><span className="exportCommitSummary"><strong>{canSubmit ? "筛选结果已准备好" : selected.length ? "请选择导出内容" : "当前没有可导出的题目"}</strong><small>{filterSummary.length ? filterSummary.join(" · ") : "未添加额外筛选"}{invalidCount ? ` · 已排除 ${invalidCount} 道失效记录` : ""} · {format === "pdf" ? `${pageLabel} · ${include.answer ? answerLabel : "不含答案"} · 预计约 ${estimatePages()} 页` : "Markdown + assets"}</small></span><div><button className="exportPrimary" disabled={!canSubmit || previewLoading} onClick={runExport}><Icon name="download" /> 导出文件</button></div></div>}
        {result && <p className="exportResult" role="status">{result}</p>}
      </div>

      <aside className={`exportPreview ${actualPreview ? "hasPreview" : ""}`}><header><span><strong>导出预览</strong><small>{format === "pdf" ? `A4 · ${pageLabel} · ${include.answer ? answerLabel : "不含答案"}` : "Markdown 文档"}</small></span><b>{actualPreview?.pages ? `${actualPreview.pages} 页` : `${selected.length} 道`}</b>{actualPreview && <button type="button" className="exportPreviewButton" disabled={!canSubmit || previewLoading || taskActive || exportLoading} onClick={() => runPreview()}>{previewLoading ? "正在生成预览…" : "更新预览"}</button>}</header>{actualPreview?.previewPages?.length ? <div className="actualPreviewViewport actualPreviewPages">{actualPreview.previewPages.map((page, index) => <figure key={`${page}:${index}`}><ResourceImage src={page} alt={`PDF 第 ${index + 1} 页`} /><figcaption>第 {index + 1} 页</figcaption></figure>)}</div> : actualPreview?.html ? <ExportHtmlPreview html={actualPreview.html} /> : actualPreview?.pdfUrl ? <div className="actualPreviewViewport"><iframe title="实际 PDF 导出预览" src={actualPreview.pdfUrl} /></div> : actualPreview?.markdown ? <div className="actualMarkdownPreview markdownPreview" dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(actualPreview.markdown) }} /> : <div className="actualPreviewEmpty"><span className="exportPreviewGlyph"><Icon name="eye" /></span><strong>预览最终文件</strong><span>快速预览只生成前 3 道题，适合调整布局；完整文件会在导出时生成。</span><button type="button" disabled={!canSubmit || previewLoading || taskActive || exportLoading} onClick={() => runPreview()}>{previewLoading ? "正在生成预览…" : "生成快速预览"}</button></div>}</aside>
    </div>
  </section>
}

/**
 * 更新确认弹窗的说明区（Classic 面板与 MN5 场景面板共用同一个视图）。
 *
 * Release 正文来自网络：有原 Markdown 时复用 AI 回答的 react-markdown + remark-gfm
 * 管线渲染（原始 HTML 转义成文本、危险协议被清空、远程图片不自动加载），
 * 没有时回退到原生算好的纯文本摘要（旧原生版本、以及原生系统弹窗都只带 notes），
 * 两者都为空才显示「暂无更新说明」。弹窗按钮位置与正文滚动容器不变。
 */
export function UpdatePromptNotes({ prompt }) {
  const markdown = typeof prompt?.notesMarkdown === "string" ? prompt.notesMarkdown.trim() : ""
  return (
    <div className="updatePromptNotes">
      {markdown
        ? <UpdatePromptMarkdown content={markdown} />
        : <p className="updatePromptPlainNotes">{prompt?.notes || "暂无更新说明"}</p>}
    </div>
  )
}
if (typeof document !== "undefined" && document.getElementById("root")) {
  createRoot(document.getElementById("root")).render(<App />)
}

// 供渲染冒烟测试（tests/web-render-smoke.test.ts）逐页签 renderToString；
// 生产入口不受影响，这些导出在打包时会被 tree-shake。
export {
  OCRDatabase,
  App,
  MistakeRefreshConsent,
  MistakeOverview,
  MistakeBrowser,
  DueReviewList,
  MistakeDetail,
  MistakeExport,
  SettingsGroup,
  RegexMatchingSettings,
  MistakeLevelGuide,
  ConnectivityResult,
  renderMarkdownPreview,
  ReviewTimeline
}
