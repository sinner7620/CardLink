import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import html2canvas from "html2canvas"
import MNBridge from "./lib/mnBridge"
import { Icon } from "./icons"
import { buildMindMapOptions, buildParentInsights, sourceInsightKey } from "../../src/source-insights"
import { REVIEW_CURVES } from "../../src/mistake-domain"
import { isManagedMistakeTag } from "../../src/mistake-tags"
import { escapeHtml } from "../../src/html-utils"
import { installWebUiColors } from "../../src/ui-tokens"
import "./ui/tokens.css"
import "./ui/controls.css"
import "./ui/shell.css"
import "./ui/overview.css"
import "./ui/mistakes.css"
import "./ui/review.css"
import "./ui/export.css"
import "./ui/settings.css"
import "./ui/detail.css"
import { useDockableBar } from "./detail-dock"
import "./a11y.css"
import { CardPreview } from "./CardPreview"
import { createReviewDetailCache } from "./lib/reviewDetailCache"
import { createMorph } from "morphicons/dom"
import { Check, Star, X, Wrench, Plus, ChevronDown, FileQuestion, FileCheck, Trash2, ChevronUp } from "lucide"
import { clearLegacyFavoriteTitles, readLegacyFavoriteTitles } from "./preview-favorites"
import { SFTileIcon, SF_TONE_COLORS } from "./sf"

const levelNames = ["不会", "不熟", "掌握"]
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
  return <span className="svgSwitch" role="switch" aria-label={label} aria-checked={checked}><MorphIcon from="toggleOff" to="toggleOn" active={checked} /></span>
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

// 到期口径（与原生 isDue 统一）：本地今天 24 点前到期即"今天到期"，
// 未来用日历差而不是 ceil 时刻差——今天 18:00 到期不该显示"剩余 1 天"。
function endOfTodayTs(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
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

function App() {
  const startupSnapshotRef = useRef(readDashboardShellCache())
  const [tab, setTab] = useState("mistakes")
  const [data, setData] = useState(startupSnapshotRef.current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [dateFilter, setDateFilter] = useState("all")
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [level, setLevel] = useState("all")
  const [categoryPath, setCategoryPath] = useState([])
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState(null)
  const [exportRecordIds, setExportRecordIds] = useState([])
  const [exportReturnTab, setExportReturnTab] = useState("settings")
  const [consentAttempt, setConsentAttempt] = useState(0)
  const [locateHint, setLocateHint] = useState("")
  const locateHintTimerRef = useRef(0)
  const [pendingNotice, setPendingNotice] = useState("")
  const [manualTodayIds, setManualTodayIds] = useState([])
  const [reviewFocusId, setReviewFocusId] = useState("")
  const [settingsPane, setSettingsPane] = useState("root")
  const [streamLoading, setStreamLoading] = useState(false)
  const selectedIdRef = useRef("")
  const dataRef = useRef(null)
  const loadSeqRef = useRef(0)
  const activeLoadRef = useRef(null)
  const queuedLoadRef = useRef(null)
  const initialLoadCompleteRef = useRef(false)
  const versionTapRef = useRef({ count: 0, lastAt: 0 })
  const aiWarningPendingRef = useRef(false)
  selectedIdRef.current = selectedId
  dataRef.current = data

  async function performLoad(quiet = false) {
    const seq = ++loadSeqRef.current
    // 整页刷新会让列表先缩回首页 25 条、滚动被钳制；记下旧滚动位置，
    // 分页续传完成后恢复（与改标签就地补丁同一目标的双保险）。
    const previousListScroll = document.querySelector(".mistakeList")?.scrollTop ?? 0
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
      setData(next)
      saveDashboardShellCache(next)
      firstPagePublished = true
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
        setData(next)
        await waitForPaint()
      }
      // AI 运行时门闸：总开关未开启时不发送任何 AI 命令，调度器保持零加载。
      if (next?.aiEnabled === true) MNBridge.send("aiRunDueSchedules").catch(() => {})
      const records = next?.mistakes?.records || []
      if (previousListScroll > 0) {
        // 等最后一次 setData 渲染完成后再恢复，两帧确保列表已按完整数据布局
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const list = document.querySelector(".mistakeList")
          if (list) list.scrollTop = previousListScroll
        }))
      }
      const currentSelectedId = selectedIdRef.current
      if (currentSelectedId && !records.some(item => item.recordId === currentSelectedId)) {
        setSelectedId("")
        setDetail(null)
      }
      else if (currentSelectedId) {
        const detail = await MNBridge.send("mistakeDetail", { recordId: currentSelectedId })
        if (seq !== loadSeqRef.current) return
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

  // 长耗时命令的等待提示：顶部进度线之外给出明确的转圈通知
  const PENDING_NOTICES = {
    repairMistakes: "正在刷新错题分类索引…",
    refreshAnswerIndex: "正在刷新答案索引…",
    checkUpdates: "正在检查插件更新…"
  }
  async function action(command, payload, reload = true) {
    // 定位、关闭面板等无数据写入动作只由各自按钮反馈，不再遮住整页并制造
    // “重载所有错题”的假象。整页 busy 只属于真正会走 dashboard 的操作。
    if (reload) setBusy(true)
    const pendingText = PENDING_NOTICES[command]
    if (pendingText) setPendingNotice(pendingText)
    setError("")
    try {
      const result = await MNBridge.send(command, payload)
      if (reload && command === "reviewMistake" && result) {
        setData(current => patchReviewedMistake(current, result))
        setBusy(false)
      }
      else if (reload && command === "changeMistakeLevel" && result?.recordId) {
        // 侧边改等级：用返回的记录就地更新队列，保证实时刷新，不依赖下一轮 dashboard。
        setData(current => patchReviewedMistake(current, result))
        setBusy(false)
      }
      else if (reload && command === "changeMistakeLevels" && Array.isArray(result?.records)) {
        // 批量更改等级：逐条就地更新。
        setData(current => result.records.reduce((data, record) => patchReviewedMistake(data, record), current))
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
      else if (command === "setDebugMode" && result) {
        // 调试开关与 setPluginEnabled 同一数据流：直接以命令结果更新 matching，
        // 不再依赖整页 dashboard 重载，大错题库下开关不再被分页状态卡住。
        setData(current => ({ ...current, matching: { ...current?.matching, debugModeEnabled: result.enabled === true } }))
        setBusy(false)
      }
      else if (reload) await load()
      else if (reload) setBusy(false)
      return result
    } catch (reason) {
      setError(reason.message || String(reason))
      if (reload) setBusy(false)
      // 操作失败（含写入回滚、记录被同步取消）也要刷新数据，让队列立刻反映真实状态。
      if (reload) await load(true)
      return undefined
    } finally {
      if (pendingText) setPendingNotice("")
    }
  }

  async function openDetail(recordId) {
    setSelectedId(recordId)
    setBusy(true)
    setError("")
    try {
      const nextDetail = await MNBridge.send("mistakeDetail", { recordId })
      setDetail(nextDetail)
      setData(current => patchReviewedMistake(current, nextDetail.record))
    } catch (reason) {
      setDetail(null)
      setError(reason.message || String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function openAISettings() {
    if (aiWarningPendingRef.current) return
    aiWarningPendingRef.current = true
    setError("")
    try {
      const result = await MNBridge.send("aiConfirmDevelopmentWarning")
      if (result?.confirmed === true) {
        setTab("settings")
        setSettingsPane("ai")
      }
    } catch (reason) {
      setError(reason.message || String(reason))
    } finally {
      aiWarningPendingRef.current = false
    }
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
    MNBridge.send("runtimeLog", { event: "boot.appRendered", detail: `elapsedMs=${Date.now() - (window.__MN_BOOT_STARTED_AT__ || Date.now())}` }).catch(() => {})
    const initialTimer = window.setTimeout(() => {
          void (async () => {
            await load(Boolean(startupSnapshotRef.current))
            initialLoadCompleteRef.current = true
          })()
        }, 0)
    window.__onPanelShow = async options => {
      setConsentAttempt(value => value + 1)
      touchLocateOnShow()
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
    window.__onNativeDataChanged = () => { touchLocateOnShow(); load() }
    return () => {
      delete window.__onPanelShow
      delete window.__onNativeDataChanged
      clearTimeout(initialTimer)
      clearTimeout(locateHintTimerRef.current)
    }
  }, [])

  function showLocateHint(message) {
    setLocateHint(String(message || ""))
    clearTimeout(locateHintTimerRef.current)
    locateHintTimerRef.current = setTimeout(() => setLocateHint(""), 6000)
  }

  const debugModeEnabled = data?.matching?.debugModeEnabled === true
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
    await action("resetPanelFrame", null, false)
    await load()
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
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return (data?.mistakes?.records || []).filter(item => {
      if (level !== "all" && String(item.level) !== level) return false
      if (categoryPath.length && !categoryPath.every((part, index) => (item.categoryPath || [])[index] === part)) return false
      if (needle && !normalizeSearch(`${item.sourceTitle} ${item.sourceNotebookTitle} ${item.categoryLabel} ${(item.sourcePathTitles || []).join(" ")} ${(item.manualCategories || []).join(" ")} ${item.manualCategory || ""}`).includes(needle)) return false
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
  }, [data, deferredQuery, level, categoryPath, dateFilter, favoritesOnly])

  const entries = [
    ["overview", "总览"],
    ["mistakes", "错题本", data?.mistakes?.totalCount ?? data?.mistakes?.records?.length ?? 0],
    ["review", "待复习", data?.mistakes?.todayDueCount || 0],
    ["settings", "设置"]
  ]

  const panelCloseSide = data?.matching?.panelCloseButtonSide === "right" ? "right" : "left"
  const refreshButton = <button className="iconButton" aria-label="刷新并复位插件窗口" title="刷新并复位窗口" onClick={refreshPanel} disabled={busy}><Icon name="refresh" /></button>
  const closeButton = <button className="iconButton" aria-label="关闭插件窗口" onClick={() => action("closePanel", null, false)}><Icon name="close" /></button>

  return <div className={`shell panelClose-${panelCloseSide} tab-${tab}`}>
    <main>
      <header className="topBar">
        <div className="topTools topTools-left">{panelCloseSide === "left" && <div className="windowControlCapsule">{closeButton}{refreshButton}</div>}</div>
        <nav className="topNav">{entries.map(([key, name, count]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setReviewFocusId(""); if (key !== "settings") setSettingsPane("root"); setTab(key) }}><strong>{name}</strong>{count > 0 && <b>{count}</b>}</button>)}</nav>
        <div className="topTools topTools-right">{panelCloseSide === "right" && <div className="windowControlCapsule">{refreshButton}{closeButton}</div>}</div>
      </header>
      {locateHint && <div className="locateHintBanner" role="alert">{locateHint}</div>}
      {pendingNotice && <div className="pendingNotice" role="status"><i /><span>{pendingNotice}</span></div>}
      <div className="pageHeading"><h1>{tab === "overview" ? "错题总览" : tab === "mistakes" ? "错题浏览" : tab === "review" ? "到期复习" : tab === "export" ? "导出错题" : settingsPane === "ai" ? "AI 错题分析（开发中…）" : "设置"}</h1><p>{tab === "overview" ? "掌握情况、到期复习和最近错题概览" : tab === "mistakes" ? "全部错题保留在原脑图中，可添加标签、核对答案并定位原题" : tab === "export" ? "从当前错题记录生成可另存的 PDF 或 Markdown 文件" : settingsPane === "ai" ? "科目、模型与数据范围" : "跨脑图答案与错题工作台"}</p></div>
      {error && <div className="workbenchError" role="alert"><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError("")}>×</button></div>}
      {busy && <div className="loading"><i />正在读取 MarginNote 数据…</div>}
      {data?.mistakes?.recordsComplete === false && streamLoading && <div className="dataStreamStatus" role="status">正在载入错题 {data.mistakes.records.length}/{data.mistakes.totalCount}…</div>}

      {tab === "overview" && <MistakeOverview
        records={data?.mistakes?.records || []}
        aiReady={data?.mistakes?.recordsComplete === true}
        aiEnabled={data?.aiEnabled === true}
        onOpenAISettings={openAISettings}
        onBrowse={() => setTab("mistakes")}
        onOpen={recordId => { setTab("mistakes"); openDetail(recordId) }}
        onSource={path => { setCategoryPath(path); setTab("mistakes") }}
      />}

      {tab === "mistakes" && <MistakeBrowser
        records={records}
        allRecords={data?.mistakes?.records || []}
        categories={data?.mistakes?.categories || []}
        customCategories={data?.mistakes?.customCategories || []}
        query={query} setQuery={setQuery}
        level={level} setLevel={setLevel}
        categoryPath={categoryPath} setCategoryPath={setCategoryPath}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        favoritesOnly={favoritesOnly}
        setFavoritesOnly={setFavoritesOnly}
        selectedId={selectedId}
        detail={detail}
        openDetail={openDetail}
        action={action}
        reloadDetail={() => selectedId && openDetail(selectedId)}
        onRemoved={() => { setSelectedId(""); setDetail(null) }}
        onExportSelected={openExport}
        onReview={recordId => { setReviewFocusId(recordId); setTab("review") }}
        showLocateHint={showLocateHint}
      />}

      {tab === "review" && <DueReviewList
        onRecordChanged={record => setData(current => patchReviewedMistake(current, record))}
        focusRecordId={reviewFocusId}
        records={(data?.mistakes?.records || []).filter(item => item.noteAvailable)}
        reviewCurves={data?.mistakes?.reviewCurves}
        action={action}
        manualTodayIds={manualTodayIds}
        setManualTodayIds={setManualTodayIds}
        showLocateHint={showLocateHint}
      />}

      {tab === "export" && <MistakeExport
        allRecords={data?.mistakes?.records || []}
        action={action}
        initialRecordIds={exportRecordIds}
        onBack={() => setTab(exportReturnTab)}
      />}

      {tab === "settings" && settingsPane === "ai" && <AIErrorBoundary onBack={() => setSettingsPane("root")}><AISettingsPage onBack={() => setSettingsPane("root")} onEnabledChanged={() => load(true)} /></AIErrorBoundary>}
      {tab === "settings" && settingsPane === "root" && <section className="settingsPage">
        <div className="settingsColumns"><div className="settingsGroups settingsPrimary">
          <SettingsGroup title="答案匹配" tone="accent" items={[
          ["bind", "同一学习集具体脑图绑定", data?.matching?.scopedBinding
            ? "已开启：每个题目脑图可绑定具体答案脑图，点击关闭"
            : "已关闭：点击开启，可选择同一学习集下的其他脑图", () => action("setScopedBinding", { enabled: !data?.matching?.scopedBinding }), <SvgSwitch checked={!!data?.matching?.scopedBinding} label="同一学习集具体脑图绑定" key="switch" />],
          ["notebook", "绑定或更换答案脑图", data?.matching?.scopedBinding
            ? "为当前题目脑图选择具体答案脑图"
            : "当前按整个答案学习集绑定；开启上方选项可绑定具体脑图", () => action("bindAnswerNotebook")],
          ["sliders", "设置答案匹配方式", data?.matching?.mode === "parent-order"
            ? `章节顺序配对：${data.matching.matchedGroups} 个父节点，${data.matching.pairs} 张卡片`
            : data?.matching?.mode === "regex"
              ? "独立正则规则匹配（不会回退到其他查找方式）"
              : "完整标题匹配、章节顺序配对或独立正则规则匹配", () => action("configureAnswerMatching")],
          ["refresh", "刷新答案索引", "仅在答案脑图内容变化后手动刷新", () => action("refreshAnswerIndex")],
          ["unlink", "解除答案绑定", "解除当前题目脑图的答案关联", () => action("unbindAnswerNotebook")]
          ]} />
          {data?.matching?.mode === "regex" &&
            <RegexMatchingSettings matching={data.matching} action={action} />}
          <SettingsGroup title="错题管理" tone="amber" items={[
          ["sliders", "AI 错题分析（开发中…）", "科目、模型与定期总结", openAISettings],
          ["flag", "标记所选卡片错题", "支持脑图多选，统一选择错题等级", () => action("markMistake")],
          ["locate", "定位当前错题原题", "跳转到当前错题记录的原脑图位置", () => action("openCurrentMistakeSource", null, false)],

          ["refresh", "刷新错题分类索引", "重新读取脑图标题、父节点路径和答案绑定", () => action("repairMistakes")],
          ["download", "导出错题", "以 PDF 或 Markdown 格式预览导出", openExport]
          ]} />
          <SettingsGroup title="插件" tone="green" items={[
          ["toggle", "卡片侧边按钮", data?.matching?.pluginEnabled === false
            ? "已关闭：不显示卡片旁的查找答案、标记错题按钮"
            : "已开启：选择卡片时显示侧边的查找答案、标记错题按钮", () => action("setPluginEnabled", { enabled: data?.matching?.pluginEnabled === false }), <SvgSwitch checked={data?.matching?.pluginEnabled !== false} label="卡片侧边按钮" key="plugin-enabled" />],
          ["info", "当前版本", `v${data?.version || "…"} · frank`, handleVersionTap],
          ["guide", "插件使用说明", "在浏览器中打开插件说明网页", () => action("openPluginGuide", null, false)],
          ["arrowsLR", "插件窗口关闭按钮", panelCloseSide === "right"
            ? "当前位于右上角，点击切换到左上角"
            : "当前位于左上角，点击切换到右上角", () => action("setPanelCloseButtonSide", { side: panelCloseSide === "right" ? "left" : "right" }), <SvgSwitch checked={panelCloseSide === "right"} label="关闭按钮位于右侧" key="close-position" />],
          ["reset", "重置窗口位置与大小", "将工作台窗口恢复到默认尺寸", () => action("resetPanelFrame", null, false)],
          ["update", "检查插件更新", "检查新版本并保存安装。", () => action("checkUpdates", null, false)]

          ]} />
          {connectivityResult && <ConnectivityResult result={connectivityResult} />}
          {debugModeEnabled && <>
            <SettingsGroup title="调试功能" tone="red" items={[
              ["fileText", "导出运行日志", "仅记录并导出调试模式开启期间的运行事件", exportRuntimeLog],
              ["wifi", "联通测试", "测试三个上报通道是否可达（仅发送测试标记，不含笔记内容）", runConnectivityTest],
              ["close", "退出调试模式", "停止日志记录并清空运行日志", () => action("setDebugMode", { enabled: false })]
            ]} />
          </>}
        </div><div className="settingsGroups settingsSecondary">
          <MistakeLevelGuide reviewCurves={data?.mistakes?.reviewCurves} action={action} />
        </div></div>
      </section>}
    </main>
    {data?.mistakeRefreshConsentRequired === true && createPortal(<MistakeRefreshConsent key={consentAttempt}
      onAccept={() => action("acceptMistakeRefreshConsent")}
      onCancel={() => action("closePanel", null, false)}
    />, document.body)}
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

function MistakeBrowser(props) {
  const { records, allRecords, selectedId, detail, openDetail, action, reloadDetail, onRemoved, onExportSelected } = props
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [removeArmed, setRemoveArmed] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
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
    <div className="browserGrid mistakeSplitView">
      <aside className="mistakeSidebar">
        <div className={`filterBar mistakeListHeader ${filtersOpen ? "" : "filtersClosed"} ${selecting ? "selectionOpen" : ""}`}>
          <div className="listToolbar">
            <button className={`batchToggle svgIconButton ${selecting ? "active" : ""}`} aria-label={selecting ? "完成多选" : "进入多选"} title={selecting ? "完成多选" : "多选"} onClick={toggleSelecting}><MorphIcon from="checkbox" to="checkboxChecked" active={selecting} /></button>
            <span className="filterCount">{selecting ? `${selectedIds.length}/${records.length}` : `共${records.length}道`}</span>
          </div>
          <div className="searchRow"><input value={props.query} onChange={event => props.setQuery(event.target.value)} placeholder="搜索题名、脑图、章节或标签" /><button type="button" className="filterCollapseButton" aria-expanded={filtersOpen} aria-label={filtersOpen ? "折叠筛选" : "展开筛选"} title={filtersOpen ? "折叠筛选" : "展开筛选"} onClick={() => setFiltersOpen(value => !value)}><Icon name={filtersOpen ? "up" : "down"} /></button></div>
          {filtersOpen && <div className="filterSelectors">
            <CategoryCascade records={allRecords} path={props.categoryPath} setPath={props.setCategoryPath} favoritesActive={props.favoritesOnly} favoritesCount={allRecords.filter(function (item) { return item.favorite === true }).length} onFavoritesToggle={props.setFavoritesOnly} />
            <span className="filterDivider" aria-hidden="true" />
            <select className="levelNarrow" aria-label="掌握等级" value={props.level} onChange={function (event) { props.setLevel(event.target.value) }}><option value="all">全部</option>{levelNames.map(function (name, index) { return <option value={String(index)} key={name}>{name}</option> })}</select>
            <span className="filterDivider" aria-hidden="true" />
            <DateFilterButton value={props.dateFilter} onChange={props.setDateFilter} />
          </div>}
          {selecting && <div className="batchBar active">
          <button data-select-all-state={allVisibleSelected ? "all" : "none"} onClick={toggleVisible} disabled={!records.length}><MorphIcon from="checkbox" to="checkboxChecked" active={allVisibleSelected} /><span>{allVisibleSelected ? "全不选" : "全选"}</span></button>
          <span className="filterDivider" aria-hidden="true" />
          <select className="batchLevelSelect" aria-label="修改错题等级" defaultValue="" disabled={!selectedIds.length} onChange={async event => { const value = event.target.value; if (value !== "") await changeSelectedLevel(Number(value)); event.target.value = "" }}><option value="">修改等级</option>{levelNames.map((name, level) => <option key={name} value={level}>{name}</option>)}</select>
          <span className="filterDivider" aria-hidden="true" />
          <button className="batchExport" onClick={() => onExportSelected(selectedIds)} disabled={!selectedIds.length}>导出</button>
          <span className="filterDivider" aria-hidden="true" />
          <button className={`batchRemove ${removeArmed ? "confirming" : ""}`} onClick={removeSelected} disabled={!selectedIds.length}>{removeArmed ? `确认取消 ${selectedIds.length} 道` : "取消错题"}</button>
          </div>}
        </div>
        <div className="mistakeList mistakeListBody">{records.map(item => <MistakeListItem key={item.recordId} item={item} selected={selectedId === item.recordId} selectable={selecting} checked={selectedSet.has(item.recordId)} onPreview={() => openDetail(item.recordId)} onToggle={() => toggleRecord(item.recordId)} />)}{!records.length && <Empty title="没有符合条件的错题" text="清空搜索或筛选条件后重试。" />}</div>
      </aside>
      <div className={`detailPane mistakeDetailSurface ${selecting ? "batchSelectionPane" : ""}`}>{detail ? <MistakeDetail key={detail.record.recordId} detail={detail} customCategories={props.customCategories} action={action} reloadDetail={reloadDetail} onRemoved={onRemoved} onReview={props.onReview} showLocateHint={props.showLocateHint} /> : <Empty title="选择一道错题" text="右侧将显示题目、答案、分类和定位操作。" />}</div>
    </div>
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

function MistakeOverview({ records, onBrowse, onOpen, onSource, aiReady, aiEnabled, onOpenAISettings }) {
  const now = Date.now()
  const due = records.filter(item => item.noteAvailable && !item.reviewCompleted && new Date(item.nextReviewAt).getTime() < endOfTodayTs()).length
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
  let sourceOffset = 0
  const sourceGradient = chartSources.length ? chartSources.map((source, index) => {
    const start = sourceOffset
    sourceOffset += source.count / Math.max(1, parentInsights.classifiedRecords) * 100
    return `${sourceColors[index]} ${start}% ${sourceOffset}%`
  }).join(",") : "#e9edf5 0 100%"
  const mastery = records.length ? Math.round(mastered / records.length * 100) : 0
  const cards = [
    ["total", "错题总数", records.length, `${mindMaps.length} 棵题目脑图`],
    ["due", "今日到期", due, due ? "建议优先复习" : "当前已清空"],
    ["weak", "需要巩固", weak, "不会或不熟"],
    ["mastered", "掌握", mastered, "稳定完成"],
    ["added", "近 7 天新增", recentCount, "持续积累"],
  ]
  return <section className="overviewPage">
    <div className="overviewHero"><div><span className="overviewKicker">学习概览</span><strong>错题本学习进度</strong><small>{due ? `有 ${due} 道错题已经到期，建议从薄弱状态开始复习` : "当前没有到期任务"}</small></div><div className="masteryRing" style={{ "--progress": `${mastery * 3.6}deg` }}><span><strong>{mastery}%</strong><small>掌握</small></span></div><div className="previewLearningProgress" data-preview-learning-progress="1"><div className="previewProgressHeading"><span>共 {records.length} 道</span></div><div className="previewProgressTrack" role="img" aria-label={levelNames.map((name, index) => `${name} ${levelCounts[index]} 道`).join("，")}>{levelCounts.map((count, index) => ({ count, index })).filter(item => item.count > 0).map(({ count, index }) => <i className={`level${index}`} key={levelNames[index]} style={{ width: `${records.length ? count / records.length * 100 : 0}%` }} />)}</div><div className="previewProgressLegend">{levelCounts.map((count, index) => <span key={levelNames[index]}><i className={`level${index}`} />{levelNames[index]}<b>{count}</b><em>{records.length ? Math.round(count / records.length * 100) : 0}%</em></span>)}</div></div></div>
    <div className="overviewCards">{cards.map(([icon, label, value, note], index) => <div className={`overviewCard tone${index}`} key={label}><i><Icon name={icon} /></i><span><small>{label}</small><strong>{value}</strong><em>{note}</em></span></div>)}</div>
    <div className="overviewPanel sourcePanel"><header><div><strong>错题来源分布</strong></div>{mindMaps.length ? <MindMapMultiSelect options={mindMaps} selectedKeys={effectiveMapKeys} setSelectedKeys={setSelectedMapKeys} /> : null}</header>{sources.length ? <div className="sourceChart"><div className="sourceDonut" style={{ background: `conic-gradient(${sourceGradient})` }}><span><strong>{parentInsights.classifiedRecords}</strong><small>有效分类</small></span></div><div className="sourceBars">{chartSources.map((source, index) => {
      const percent = Math.round(source.count / Math.max(1, parentInsights.classifiedRecords) * 100)
      return <button key={source.key} disabled={!source.path?.length} onClick={() => source.path?.length && onSource(source.path)}><i style={{ background: sourceColors[index] }} /><span><strong>{source.name}</strong><small>{source.mapName}{source.weak ? ` · ${source.weak} 道薄弱` : ""}</small><em><b style={{ width: `${percent}%`, background: sourceColors[index] }} /></em></span><b>{source.count}<small>{percent}%</small></b></button>
    })}</div></div> : mindMaps.length ? <Empty title="暂无有效父节点分类" text="所选脑图的父节点当前会形成“一题一类”或“全部一类”，已自动跳过无效统计。" icon={false} /> : <Empty title="暂无来源数据" text="标记错题后可按题目脑图内父节点统计。" icon={false} />}
    <StudyHistoryChart records={records} />
    </div>
    <div className="overviewGrid">
      <div className="overviewPanel"><header><strong>三档掌握情况</strong><small>不会、不熟、掌握</small></header><div className="levelChart">{levelCounts.map((count, level) => <div className="levelRow" key={level}><span>{levelNames[level]}</span><div><i className={`levelBar level${level}`} style={{ width: `${Math.max(count ? 8 : 0, count / maxLevelCount * 100)}%` }} /></div><b>{count}</b></div>)}</div></div>
      <div className="overviewPanel recentPanel"><header><strong>最近添加</strong><button onClick={onBrowse}>浏览全部</button></header><div>{recent.map(item => <button className="recentItem" key={item.recordId} onClick={() => onOpen(item.recordId)}><span className={`level level${item.level}`}>{levelNames[item.level]}</span><span><strong>{item.sourceTitle}</strong><small>{formatDate(item.createdAt)} · {item.reviewCompleted ? "已结束" : reviewCountdown(item.nextReviewAt)}</small></span><b><Icon name="right" /></b></button>)}{!recent.length && <Empty title="还没有错题" text="从卡片侧边标记第一道错题。" />}</div></div>
    </div>
    <AIErrorBoundary><AIOverview ready={aiReady} enabled={aiEnabled === true} onOpenSettings={onOpenAISettings} /></AIErrorBoundary>
  </section>
}

class AIErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: "" } }
  static getDerivedStateFromError(error) { return { error: error?.message || "AI 模块载入失败" } }
  componentDidCatch(error) { MNBridge.send("runtimeLog", { event: "ai.ui.error", detail: String(error?.message || error) }).catch(() => {}) }
  render() { return this.state.error ? <section className="overviewPanel aiOverview"><div className="aiInlineError">{this.state.error}</div>{this.props.onBack && <button className="aiBackFallback" onClick={this.props.onBack}>返回设置</button>}</section> : this.props.children }
}

function AIOverview({ ready, enabled, onOpenSettings }) {
  const [settings, setSettings] = useState(null), [reports, setReports] = useState([])
  const [subjectId, setSubjectId] = useState(""), [preview, setPreview] = useState(null)
  const [job, setJob] = useState(null), [report, setReport] = useState(null), [error, setError] = useState("")
  async function load() {
    try {
      const [nextSettings, nextReports] = await Promise.all([MNBridge.send("aiGetSettings"), MNBridge.send("aiListReports")])
      setSettings(nextSettings); setReports(nextReports || [])
      setSubjectId(current => current || nextSettings.subjects?.[0]?.id || "")
    } catch (reason) { setError(reason.message || String(reason)) }
  }
  useEffect(() => { if (ready && enabled) load() }, [ready, enabled])
  const selected = settings?.subjects?.find(item => item.id === subjectId)
  const latest = reports.find(item => item.subjectId === subjectId)
  useEffect(() => { setPreview(null); if (!latest) return setReport(null); MNBridge.send("aiGetReport", { reportId: latest.id }).then(setReport).catch(() => setReport(null)) }, [subjectId, latest?.id])
  useEffect(() => {
    if (!job?.id || ["done", "failed", "cancelled"].includes(job.status)) return
    const timer = setInterval(async () => {
      const next = await MNBridge.send("aiGetJob", { jobId: job.id }); setJob(next)
      if (next.status === "done") { const value = await MNBridge.send("aiGetReport", { reportId: next.reportId }); setReport(value); setPreview(null); load() }
      if (next.status === "failed") setError(next.error || "分析失败")
    }, 900)
    return () => clearInterval(timer)
  }, [job?.id, job?.status])
  async function inspect() { setError(""); try { setPreview(await MNBridge.send("aiPreviewAnalysis", { subjectId })) } catch (reason) { setError(reason.message || String(reason)) } }
  async function start() { setError(""); try { setJob(await MNBridge.send("aiStartAnalysis", { subjectId })) } catch (reason) { setError(reason.message || String(reason)) } }
  const running = job && !["done", "failed", "cancelled"].includes(job.status)
  const openEvidence = reference => report && MNBridge.send("aiOpenEvidence", { reportId: report.id, reference }).catch(reason => setError(reason.message || String(reason)))
  if (!ready) return <section className="overviewPanel aiOverview"><header><strong>AI 错题总结（开发中…）</strong></header><div className="aiEmpty">错题加载完成后可用</div></section>
  if (!enabled) return <section className="overviewPanel aiOverview"><header><strong>AI 错题总结（开发中…）</strong></header><div className="aiEmpty"><span>AI 分析未开启</span><button className="aiBackFallback" onClick={onOpenSettings}>前往配置</button></div></section>
  return <section className="overviewPanel aiOverview">
    <header><strong>AI 错题总结（开发中…）</strong><div className="aiOverviewActions"><select value={subjectId} onChange={event => setSubjectId(event.target.value)} aria-label="选择科目"><option value="">选择科目</option>{(settings?.subjects || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={!selected || running || !settings?.enabled} onClick={inspect}>生成总结</button></div></header>
    {!settings?.enabled ? <div className="aiEmpty">AI 分析未开启</div> : !selected ? <div className="aiEmpty">请先在设置中配置科目</div> : <>
      {latest && <div className="aiReportMeta"><span>{latest.stale ? "数据已变化" : "最新报告"}</span><b>{new Date(latest.createdAt).toLocaleDateString()}</b><em>{latest.model}</em></div>}
      {preview && <div className="aiPreflight"><b>{preview.recordCount} 道错题</b><span>本次候选 {preview.analyzableCount} 道 · 可用 {preview.preparedCount} 道</span><span>{preview.needsPreparation || 0} 道需准备或检查发送范围</span><span>{preview.withHistory} 道有复习记录</span><span>{preview.withoutAnswerBinding} 道未绑定答案</span><button disabled={!preview.preparedCount} onClick={start}>确认生成</button></div>}
      {running && <div className="aiJob"><i style={{ width: `${job.progress || 0}%` }} /><span>{job.detail || (job.status === "preparing" ? "读取错题" : job.status === "ocr" ? "识别图片" : job.status === "analyzing" ? "生成总结" : "保存报告")} · {job.progress || 0}%</span><button onClick={() => MNBridge.send("aiCancelJob", { jobId: job.id })}>取消</button></div>}
      {error && <div className="aiInlineError">{error}</div>}
      {report && <AIReport report={report} openEvidence={openEvidence} />}
      {!report && !preview && !running && <div className="aiEmpty">尚无总结</div>}
    </>}
  </section>
}

function EvidenceLinks({ values, onOpen }) { return <span className="aiEvidence">{(values || []).slice(0, 6).map(value => <button key={value} onClick={() => onOpen(value)}>{value}</button>)}</span> }
function AIReport({ report, openEvidence }) {
  const content = report.content || {}
  return <div className="aiReport">
    <section className="aiSummary"><strong>{content.summary}</strong><div>{(content.strengths || []).map(item => <span key={item}>{item}</span>)}</div></section>
    <ReportSection title="薄弱点" items={content.weakPoints} render={item => <><header><strong>{item.title}</strong><b>{item.severity}</b></header><p>{item.reason}</p><small>{item.suggestion}</small><EvidenceLinks values={item.evidence} onOpen={openEvidence} /></>} />
    <ReportSection title="错误模式" items={content.errorPatterns} render={item => <><strong>{item.title}</strong><p>{item.detail}</p><EvidenceLinks values={item.evidence} onOpen={openEvidence} /></>} />
    <ReportSection title="复习建议" items={content.reviewAdvice} render={item => <><header><b>{item.priority}</b><strong>{item.title}</strong></header><p>{item.action}</p><EvidenceLinks values={item.evidence} onOpen={openEvidence} /></>} />
    <ReportSection title="分析依据" items={(content.limitations || []).map(title => ({ title }))} render={item => <span>{item.title}</span>} />
  </div>
}
function ReportSection({ title, items = [], render }) { if (!items.length) return null; return <section className="aiReportSection"><h3>{title}</h3><div>{items.map((item, index) => <article key={`${title}-${index}`}>{render(item)}</article>)}</div></section> }

function normalizeAISettingsView(value) {
  const input = value && typeof value === "object" ? value : {}
  const profiles = Array.isArray(input.profiles) ? input.profiles : []
  const subjects = Array.isArray(input.subjects) ? input.subjects.map(subject => ({
    ...subject,
    studySetIds: Array.isArray(subject?.studySetIds) ? subject.studySetIds : [],
    schedule: { enabled: false, frequency: "weekly", hour: 9, weekday: 1, monthday: 1, ...(subject?.schedule || {}) },
  })) : []
  return {
    ...input,
    enabled: input.enabled === true,
    profiles,
    subjects,
    credentials: input.credentials && typeof input.credentials === "object" ? input.credentials : {},
    ocrEngine: input.ocrEngine === "glm-ocr" ? "glm-ocr" : "mineru",
    mineru: { enabled: false, enableFormula: true, enableTable: true, credentialRef: "mineru-token", ...(input.mineru || {}) },
    glmOcr: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", credentialRef: "ocr-glm", model: "glm-ocr", timeoutMs: 120000, ...(input.glmOcr || {}) },
    privacy: { includeAnswer: true, includeSourcePath: true, includeReviewHistory: true, includeCustomCategories: true,
      handwriting: input.privacy?.handwriting === true || input.privacy?.mindMapHandwriting === true || input.privacy?.handwritingToModel === true, ...(input.privacy || {}) },
  }
}

const AI_FREQUENCY_LABELS = { daily: "每天", weekly: "每周", monthly: "每月" }
const AI_POLICY_LABELS = { auto: "有图片或手写时识别", all: "整卡识别", "image-only": "仅无题干文字的图片题", never: "不使用 OCR" }
const AI_IMAGE_LABELS = { "when-needed": "有图片时允许 OCR", always: "允许整卡 OCR", never: "禁止图片上传（含手写）" }

const OCR_STAGE_LABELS = {
  "waiting-render": "等待渲染",
  rendering: "正在渲染",
  queued: "等待 OCR",
  uploading: "正在上传",
  ocr: "正在识别",
  success: "识别成功",
  failed: "识别失败"
}

const BOUND_HANDWRITING_LABELS = {
  included: "已加入脑图绑定手写",
  none: "此题没有脑图绑定手写",
  unsupported: "当前 MarginNote 版本不支持读取脑图绑定手写",
  unreadable: "检测到脑图绑定手写，但媒体数据不可读"
}

function QuestionPreparationWorkspace({ studySets, ocrEngine, includeHandwriting, onStorageChanged, onStatus }) {
  const [studySetId, setStudySetId] = useState("")
  const [job, setJob] = useState(null)
  const [questionHtml, setQuestionHtml] = useState("")
  const [handwritingRender, setHandwritingRender] = useState(false)
  const [nativeOnly, setNativeOnly] = useState(false)
  const [previewImage, setPreviewImage] = useState("")
  const [busy, setBusy] = useState(false)
  const requestedRef = useRef("")
  const submittedRef = useRef("")
  const advancedRef = useRef("")

  useEffect(() => {
    if (!studySetId && studySets[0]?.id) setStudySetId(studySets[0].id)
  }, [studySets, studySetId])

  useEffect(() => {
    if (!job?.id || ["done", "cancelled", "missing"].includes(job.status)) return undefined
    let disposed = false
    let timer = 0
    async function poll() {
      try {
        const fresh = await MNBridge.send("aiGetQuestionPreparationJob", { jobId: job.id })
        if (disposed) return
        setJob(fresh)
        if (!["done", "cancelled", "missing"].includes(fresh.status)) timer = window.setTimeout(poll, 700)
        else if (fresh.status === "done") onStorageChanged?.()
      } catch (reason) {
        if (!disposed) onStatus(reason?.message || String(reason))
      }
    }
    timer = window.setTimeout(poll, 350)
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [job?.id])

  useEffect(() => {
    const current = job?.current
    if (!job?.id || !current || current.stage !== "waiting-render") return
    const key = `${job.id}:${current.recordId}`
    if (requestedRef.current === key) return
    requestedRef.current = key
    submittedRef.current = ""
    advancedRef.current = ""
    setQuestionHtml("")
    setPreviewImage("")
    MNBridge.send("aiGetPreparationQuestion", { jobId: job.id, recordId: current.recordId })
      .then(result => { setQuestionHtml(result.questionHtml || ""); setHandwritingRender(result.includeHandwriting === true); setNativeOnly(result.nativeOnly === true) })
      .catch(reason => onStatus(reason?.message || String(reason)))
  }, [job?.id, job?.current?.recordId, job?.current?.stage])

  useEffect(() => {
    const current = job?.current
    if (!job?.id || job.status !== "waiting-advance" || !current || !["success", "failed"].includes(current.stage)) return undefined
    const key = `${job.id}:${current.recordId}:${current.stage}`
    if (advancedRef.current === key) return undefined
    advancedRef.current = key
    const timer = window.setTimeout(async () => {
      try { setJob(await MNBridge.send("aiAdvanceQuestionPreparation", { jobId: job.id })) }
      catch (reason) { onStatus(reason?.message || String(reason)) }
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [job?.id, job?.status, job?.current?.recordId, job?.current?.stage])

  async function start() {
    if (!studySetId || busy) return
    setBusy(true)
    onStatus("正在创建 OCR 题目准备任务…")
    try {
      requestedRef.current = ""
      submittedRef.current = ""
      advancedRef.current = ""
      setQuestionHtml("")
      setPreviewImage("")
      const next = await MNBridge.send("aiStartQuestionPreparation", { studySetId })
      setJob(next)
      onStatus(next.total ? `已加入 ${next.total} 道错题` : "所选学习集没有错题")
    } catch (reason) { onStatus(reason?.message || String(reason)) }
    finally { setBusy(false) }
  }

  async function cancel() {
    if (!job?.id) return
    await MNBridge.send("aiCancelQuestionPreparation", { jobId: job.id })
    setJob(current => current ? { ...current, status: "cancelled" } : current)
    onStatus("题目准备任务已取消")
  }

  async function renderAndSubmit(event) {
    const current = job?.current
    if (!job?.id || !current || !questionHtml) return
    const key = `${job.id}:${current.recordId}`
    if (submittedRef.current === key) return
    submittedRef.current = key
    try {
      const doc = event.currentTarget.contentDocument
      if (!doc?.body) throw new Error("题目卡片渲染窗口不可用")
      await doc.fonts?.ready
      await Promise.all(Array.from(doc.images || []).map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
        const finish = () => resolve()
        image.addEventListener("load", finish, { once: true })
        image.addEventListener("error", finish, { once: true })
        window.setTimeout(finish, 5000)
      })))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      // 先逐个捕获手写内容元素，再隐藏后截整卡：OCR 截图永远不含手写。
      const handwritingDataUris = []
      const handwritingNodes = []
      if (handwritingRender) {
        const boundSection = doc.querySelector(".bound-mindmap-handwriting")
        if (boundSection) handwritingNodes.push(boundSection)
        for (const drawing of Array.from(doc.querySelectorAll("canvas[data-drawing]"))) {
          const holder = drawing.closest("figure") || drawing
          if (!handwritingNodes.includes(holder)) handwritingNodes.push(holder)
        }
        for (const node of handwritingNodes) {
          try {
            const nodeScale = Math.max(.75, Math.min(1.5, 6000 / Math.max(1, node.scrollHeight || 1)))
            const nodeCanvas = await html2canvas(node, { backgroundColor: "#ffffff", logging: false, useCORS: true, scale: nodeScale })
            handwritingDataUris.push(nodeCanvas.toDataURL("image/jpeg", .9))
          } catch {}
        }
      }
      for (const node of handwritingNodes) node.style.visibility = "hidden"
      const width = Math.max(640, doc.documentElement.scrollWidth, doc.body.scrollWidth)
      const height = Math.max(1, doc.documentElement.scrollHeight, doc.body.scrollHeight)
      const scale = Math.max(.5, Math.min(1.5, 12000 / height))
      const canvas = await html2canvas(doc.body, { backgroundColor: "#ffffff", logging: false, useCORS: true, scale, width, height, windowWidth: width, windowHeight: height })
      const imageDataUri = canvas.toDataURL("image/jpeg", .9)
      setPreviewImage(imageDataUri)
      // 原生文字直读题不上传截图；图片题才提交整卡（截图内已隐藏手写）。
      await MNBridge.send("aiSubmitPreparationImage", { jobId: job.id, recordId: current.recordId, imageDataUri: nativeOnly ? "" : imageDataUri, handwritingDataUris })
    } catch (reason) {
      const message = reason?.message || String(reason)
      onStatus(message)
      try { await MNBridge.send("aiFailPreparationQuestion", { jobId: job.id, recordId: current.recordId, error: message }) } catch {}
    }
  }

  const current = job?.current
  const running = job && !["done", "cancelled", "missing"].includes(job.status)
  const itemProgress = Math.max(0, Math.min(100, Number(current?.progress || 0)))
  const totalProgress = Math.max(0, Math.min(100, Number(job?.totalProgress || 0)))
  return <div className="aiPreparationWorkspace">
    <div className="aiPreparationControls">
      <label><span>选择含错题的学习集</span><select value={studySetId} disabled={running} onChange={event => setStudySetId(event.target.value)}>{studySets.map(set => <option key={set.id} value={set.id}>{set.title}（{set.mistakeCount} 题）</option>)}</select></label>
      <p>有题干文字的题目直接读取原生文字；含图片的题目才渲染去除手写后的整张卡片，交给 {ocrEngine === "glm-ocr" ? "GLM-OCR" : "MinerU"} 识别成文字。{includeHandwriting ? "已开启手写内容：手写部分另存为独立图片随对应题目发送给分析模型，不进入 OCR。" : "未开启手写内容：手写不会以任何形式发送。"}分析前会核对题目、手写和发送范围，旧 OCR 可能需要重新准备。</p>
      <div className="aiEditorActions"><button type="button" disabled={!studySetId || busy || running} onClick={start}>{busy ? "正在启动…" : "开始准备错题"}</button>{running && <button type="button" className="aiDangerButton" onClick={cancel}>取消</button>}</div>
      {!studySets.length && <small className="aiPreparationEmpty">当前没有包含错题的学习集，无需 OCR。</small>}
      {job && <dl className="aiPreparationCounts"><div><dt>题目总数</dt><dd>{job.total || 0}</dd></div><div><dt>成功</dt><dd>{job.success || 0}</dd></div><div><dt>失败</dt><dd>{job.failed || 0}</dd></div></dl>}
    </div>
    <div className="aiPreparationMonitor">
      <div className="aiPreparationPreview">
        {previewImage ? <img src={previewImage} alt={`当前上传的题目卡片：${current?.title || ""}`} /> : questionHtml ? <iframe title="待上传题目卡片" srcDoc={questionHtml} onLoad={renderAndSubmit} /> : <div><Icon name="image" /><span>{job?.status === "done" ? "题目准备已完成" : "当前上传的题目卡片会显示在这里"}</span></div>}
      </div>
      {job && <div className="aiPreparationProgress">
        <div className="aiPreparationProgressLabel"><span>单题进度 · {OCR_STAGE_LABELS[current?.stage] || (job.status === "done" ? "已完成" : "等待开始")}</span><b>{Math.round(itemProgress)}%</b></div>
        <progress max="100" value={itemProgress} />
        <small>{current ? `${current.index}/${current.total} · ${current.title} · ${current.detail || ""}` : "没有待处理题目"}</small>
        {current?.boundHandwritingStatus && current.boundHandwritingStatus !== "disabled" && <small>{BOUND_HANDWRITING_LABELS[current.boundHandwritingStatus] || "脑图绑定手写状态未知"}{current.boundHandwritingCount ? `（${current.boundHandwritingCount} 项）` : ""}</small>}
        <div className="aiPreparationProgressLabel"><span>总进度</span><b>{Math.round(totalProgress)}%</b></div>
        <progress max="100" value={totalProgress} />
        <div className="aiPreparationOcr"><strong>OCR 返回文本</strong><pre>{current?.ocrText || (current?.error ? `识别失败：${current.error}` : "识别完成后将在这里显示")}</pre></div>
      </div>}
    </div>
  </div>
}

function OCRResultBrowser({ items, onStatus }) {
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!items.length) { setSelectedId(""); setDetail(null); return }
    if (!items.some(item => item.recordId === selectedId)) setSelectedId(items[0].recordId)
  }, [items, selectedId])

  useEffect(() => {
    if (!selectedId) return undefined
    let disposed = false
    setLoading(true)
    MNBridge.send("aiGetPreparedQuestion", { recordId: selectedId }).then(value => {
      if (!disposed) setDetail(value)
    }).catch(reason => {
      if (!disposed) onStatus(reason?.message || String(reason))
    }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [selectedId])

  if (!items.length) return <div className="aiOcrBrowserEmpty"><Icon name="image" /><span>完成题目 OCR 后，可在这里逐题核对原题卡片与识别文本。</span></div>
  const selected = items.find(item => item.recordId === selectedId) || items[0]
  return <section className="aiOcrBrowser" aria-label="OCR 结果对比">
    <header>
      <label><span>选择题目</span><select value={selectedId} onChange={event => setSelectedId(event.target.value)}>{items.map((item, index) => <option key={item.recordId} value={item.recordId}>{index + 1}. {item.sourceTitle}</option>)}</select></label>
      <small>{selected?.sourceNotebookTitle || "原学习集"} · {selected?.provider === "local" ? "直接读取文字" : selected?.provider === "bigmodel" ? "GLM-OCR" : "MinerU"}{selected?.includedMindMapHandwriting ? ` · 含 ${selected.boundHandwritingCount || 1} 项脑图手写` : ""}</small>
    </header>
    <div className="aiOcrCompare">
      <figure><figcaption>发送给 OCR 的原题卡片</figcaption>{detail?.imageDataUri ? <img src={detail.imageDataUri} alt={`${selected?.sourceTitle || "题目"} OCR 原图`} /> : <div className="aiOcrMissingImage">{loading ? "正在读取图片…" : detail?.provider === "local" ? "此题直接读取文字，未上传图片" : "历史记录未保存原题图片，请重新 OCR 此题"}</div>}</figure>
      <section><h3>OCR 文本渲染</h3>{loading ? <div className="aiOcrRenderedEmpty">正在读取 OCR 文本…</div> : detail?.questionText ? <div className="markdownPreview aiOcrRenderedText" dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(detail.questionText) }} /> : <div className="aiOcrRenderedEmpty">没有可显示的 OCR 文本</div>}</section>
    </div>
    {detail?.processedAt && <footer>识别时间：{new Date(detail.processedAt).toLocaleString()}</footer>}
  </section>
}

/** 导出快速预览：A4 版面（760px）按固定 60% 等比缩放显示。 */
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
      <iframe title="实际 PDF 导出预览" srcDoc={html} onLoad={onLoad}
        style={{ width: `${EXPORT_PREVIEW_FRAME_WIDTH}px`, height: `${frameHeight}px`, transform: `scale(${EXPORT_PREVIEW_SCALE})`, transformOrigin: "0 0" }} />
    </div>
  </div>
}

function AISwitch({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`aiSwitch${checked ? " on" : ""}`} onClick={() => onChange(!checked)}><i /></button>
}

function AISettingsPage({ onBack, onEnabledChanged }) {
  const [settings, setSettings] = useState(null), [studySets, setStudySets] = useState([]), [mistakeStudySets, setMistakeStudySets] = useState([]), [newSubject, setNewSubject] = useState(""), [status, setStatus] = useState(""), [cacheStats, setCacheStats] = useState(null), [reportList, setReportList] = useState([]), [preparedQuestions, setPreparedQuestions] = useState([])
  const [expandedKey, setExpandedKey] = useState("")
  const pageRef = useRef(null)
  const toggleEditor = key => setExpandedKey(current => current === key ? "" : key)
  async function loadStorage() { const [stats, list, questions] = await Promise.all([MNBridge.send("aiGetCacheStats"), MNBridge.send("aiListReports"), MNBridge.send("aiListPreparedQuestions")]); setCacheStats(stats); setReportList(list || []); setPreparedQuestions(Array.isArray(questions) ? questions : []) }
  useEffect(() => { Promise.all([MNBridge.send("aiGetSettings"), MNBridge.send("aiListStudySets"), MNBridge.send("aiListMistakeStudySets")]).then(([a, b, c]) => { const next = normalizeAISettingsView(a); setSettings(next); setStudySets(Array.isArray(b) ? b : []); setMistakeStudySets(Array.isArray(c) ? c : []); if (next.enabled) loadStorage() }).catch(reason => setStatus(reason.message || String(reason))) }, [])
  useLayoutEffect(() => { pageRef.current?.scrollTo?.({ top: 0, left: 0 }) }, [])
  async function save(next) { const normalized = normalizeAISettingsView(next); const previousEnabled = settings?.enabled === true; setSettings(normalized); try { const savedState = normalizeAISettingsView(await MNBridge.send("aiSaveSettings", normalized)); setSettings(savedState); setStatus("已保存"); if (savedState.enabled) loadStorage(); if (savedState.enabled !== previousEnabled) onEnabledChanged?.() } catch (reason) { setStatus(reason.message || String(reason)) } }
  if (!settings) return <section className="aiSettingsPage" ref={pageRef}><div className="aiEmpty">正在读取…</div></section>
  const profiles = Array.isArray(settings.profiles) ? settings.profiles : []
  const subjects = Array.isArray(settings.subjects) ? settings.subjects : []
  const activeProfile = profiles.find(item => item.id === settings.defaultProfileId)
  function patchProfile(id, change) { save({ ...settings, profiles: profiles.map(item => item.id === id ? { ...item, ...change } : item) }) }
  function patchSubject(id, change) { save({ ...settings, subjects: subjects.map(item => item.id === id ? { ...item, ...change } : item) }) }
  function addSubject() { const name = newSubject.trim(); if (!name) return; save({ ...settings, subjects: [...subjects, { id: `subject-${Date.now().toString(36)}`, name, studySetIds: [], schedule: { enabled: false, frequency: "weekly", hour: 9, weekday: 1, monthday: 1 } }] }); setNewSubject("") }
  function credentialLabel(ref) { const state = settings.credentials?.[ref]; return state?.configured ? `已配置 ····${state.maskedSuffix || ""}` : "未配置" }
  async function clearCredential(ref) { try { await MNBridge.send("aiClearCredential", { credentialRef: ref }); setSettings(normalizeAISettingsView(await MNBridge.send("aiGetSettings"))); setStatus("已清除密钥") } catch (reason) { setStatus(reason?.message || String(reason)) } }
  async function testProvider(profile) {
    setStatus(`正在测试 ${profile.name}…`)
    try {
      const result = await MNBridge.send("aiTestProvider", { profileId: profile.id })
      setStatus(result?.connected ? `${profile.name} 连接成功 · ${result.model}` : `${profile.name} 未返回测试结果`)
    } catch (reason) {
      setStatus(reason?.message || String(reason))
    }
  }
  const privacyRows = [
    ["includeAnswer", "参考答案", "第一个绑定的参考答案文字"],
    ["includeSourcePath", "章节路径", "题目在原脑图中的位置"],
    ["includeReviewHistory", "复习历史", "掌握等级与复测记录"],
    ["includeCustomCategories", "自定义标签", "错题上手动添加的标签"]
  ]
  return <section className="aiSettingsPage" ref={pageRef}>
    <header className="aiSettingsToolbar">
      <button onClick={onBack} aria-label="返回设置">‹ 返回</button>
      <div><h1>AI 错题分析</h1><p>科目、AI 服务与发送范围</p></div>
      <span role="status">{status}</span>
    </header>
    <div className="aiSettingsComposer">
      <div className="settingsGroup aiEnableGroup">
        <div className="aiRow">
          <span className="aiRowMain"><strong>启用 AI 错题分析</strong><small>关闭后不加载 AI 模块，也不会发送任何内容</small></span>
          <AISwitch checked={settings.enabled} onChange={value => save({ ...settings, enabled: value })} label="启用 AI 错题分析" />
        </div>
      </div>
      <div className="settingsGroup aiServiceGroup"><h2>AI 服务</h2>
        <div className="aiRow">
          <span className="aiRowMain"><strong>分析错题 AI</strong><small>选择用于生成错题总结的服务</small></span>
          <select value={settings.defaultProfileId} aria-label="选择分析错题 AI" onChange={event => save({ ...settings, defaultProfileId: event.target.value })}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
        </div>
        {activeProfile && <>
          <button type="button" className="aiRow aiRowButton" aria-expanded={expandedKey === "profile"} onClick={() => toggleEditor("profile")}>
            <span className="aiRowMain"><strong>分析服务配置</strong><small>{activeProfile.type === "deepseek" ? "DeepSeek" : "OpenAI 兼容"} · {activeProfile.model} · {credentialLabel(activeProfile.credentialRef)}</small></span>
            <b>{expandedKey === "profile" ? "收起" : "编辑"}</b>
          </button>
          {expandedKey === "profile" && <div className="aiEditor">
            <label className="aiEditorField"><span>名称</span><input value={activeProfile.name} aria-label="服务名称" onChange={event => patchProfile(activeProfile.id, { name: event.target.value })} /></label>
            <label className="aiEditorField"><span>API 地址</span><input value={activeProfile.baseUrl} aria-label="API 地址" onChange={event => patchProfile(activeProfile.id, { baseUrl: event.target.value })} /></label>
            <label className="aiEditorField"><span>模型</span><input value={activeProfile.model} aria-label="模型" onChange={event => patchProfile(activeProfile.id, { model: event.target.value })} /></label>
            <div className="aiEditorActions">
              <button onClick={() => MNBridge.send("aiSetCredential", { credentialRef: activeProfile.credentialRef, persistence: "session" }).then(() => MNBridge.send("aiGetSettings")).then(value => setSettings(normalizeAISettingsView(value)))}>本次密钥</button>
              <button onClick={() => MNBridge.send("aiSetCredential", { credentialRef: activeProfile.credentialRef, persistence: "local" }).then(() => MNBridge.send("aiGetSettings")).then(value => setSettings(normalizeAISettingsView(value)))}>本地保存</button>
              <button className="aiDangerButton" onClick={() => clearCredential(activeProfile.credentialRef)}>清除密钥</button>
              <button onClick={() => testProvider(activeProfile)}>测试</button>
              <span className="aiCredentialState">{credentialLabel(activeProfile.credentialRef)}</span>
            </div>
          </div>}
        </>}
        <button type="button" className="aiRow aiRowButton" aria-expanded={expandedKey === "ocr"} onClick={() => toggleEditor("ocr")}>
          <span className="aiRowMain"><strong>题目识别（OCR）</strong><small>{settings.mineru.enabled ? `${settings.ocrEngine === "glm-ocr" ? "GLM-OCR · 智谱" : "MinerU"} · 公式${settings.mineru.enableFormula ? "开" : "关"} · 表格${settings.mineru.enableTable ? "开" : "关"}` : "已关闭 · 图片题不会发送"}</small></span>
          <b>{expandedKey === "ocr" ? "收起" : "编辑"}</b>
        </button>
        {expandedKey === "ocr" && <div className="aiEditor">
          <div className="aiRow"><span className="aiRowMain"><strong>启用题目识别</strong><small>整张题目卡片（不含手写）识别成文字后发送；关闭后图片题不会发送，文字题仍直接读取</small></span><AISwitch checked={settings.mineru.enabled} onChange={value => save({ ...settings, mineru: { ...settings.mineru, enabled: value } })} label="启用题目识别" /></div>
          <label className="aiRow"><span className="aiRowMain"><strong>识别引擎</strong></span><select value={settings.ocrEngine} onChange={event => save({ ...settings, ocrEngine: event.target.value })}><option value="mineru">MinerU</option><option value="glm-ocr">GLM-OCR（智谱）</option></select></label>
          {settings.ocrEngine === "mineru" ? <>
            <div className="aiRow"><span className="aiRowMain"><strong>公式识别</strong></span><AISwitch checked={settings.mineru.enableFormula} onChange={value => save({ ...settings, mineru: { ...settings.mineru, enableFormula: value } })} label="公式识别" /></div>
            <div className="aiRow"><span className="aiRowMain"><strong>表格识别</strong></span><AISwitch checked={settings.mineru.enableTable} onChange={value => save({ ...settings, mineru: { ...settings.mineru, enableTable: value } })} label="表格识别" /></div>
            <div className="aiEditorActions"><button onClick={() => MNBridge.send("aiSetCredential", { credentialRef: settings.mineru.credentialRef, persistence: "session" }).then(() => MNBridge.send("aiGetSettings")).then(value => setSettings(normalizeAISettingsView(value)))}>本次 Token</button><button onClick={() => MNBridge.send("aiSetCredential", { credentialRef: settings.mineru.credentialRef, persistence: "local" }).then(() => MNBridge.send("aiGetSettings")).then(value => setSettings(normalizeAISettingsView(value)))}>本地保存</button><button className="aiDangerButton" onClick={() => clearCredential(settings.mineru.credentialRef)}>清除密钥</button><button onClick={() => MNBridge.send("aiTestMinerU").then(() => setStatus("MinerU 已连接")).catch(reason => setStatus(reason.message || String(reason)))}>测试</button><span className="aiCredentialState">{credentialLabel(settings.mineru.credentialRef)}</span></div>
          </> : <>
            <label className="aiEditorField"><span>API 地址</span><input value={settings.glmOcr.baseUrl} aria-label="GLM-OCR API 地址" onChange={event => save({ ...settings, glmOcr: { ...settings.glmOcr, baseUrl: event.target.value } })} /></label>
            <label className="aiEditorField"><span>模型</span><input value="glm-ocr" aria-label="GLM-OCR 模型" disabled /></label>
            <small className="aiOcrHint">整张题目卡片以 JPG 发送给 OCR 服务识别为文字；官方限制单图不超过 10 MB。</small>
            <div className="aiEditorActions"><button onClick={() => MNBridge.send("aiSetCredential", { credentialRef: settings.glmOcr.credentialRef, persistence: "session" }).then(() => MNBridge.send("aiGetSettings")).then(value => setSettings(normalizeAISettingsView(value)))}>本次 API Key</button><button onClick={() => MNBridge.send("aiSetCredential", { credentialRef: settings.glmOcr.credentialRef, persistence: "local" }).then(() => MNBridge.send("aiGetSettings")).then(value => setSettings(normalizeAISettingsView(value)))}>本地保存</button><button className="aiDangerButton" onClick={() => clearCredential(settings.glmOcr.credentialRef)}>清除密钥</button><span className="aiCredentialState">{credentialLabel(settings.glmOcr.credentialRef)}</span></div>
          </>}
        </div>}

      </div>
      <div className="settingsGroup aiPrivacyGroup"><h2>发送内容</h2>
        {privacyRows.map(([key, label, hint]) => <div key={key} className="aiRow"><span className="aiRowMain"><strong>{label}</strong><small>{hint}</small></span><AISwitch checked={settings.privacy[key]} onChange={value => save({ ...settings, privacy: { ...settings.privacy, [key]: value } })} label={label} /></div>)}
        <div className="aiRow"><span className="aiRowMain"><strong>手写内容</strong><small>卡片内手写与脑图绑定手写统一处理；手写不进入 OCR，开启后以图片随对应题目发送给分析模型</small></span><AISwitch checked={settings.privacy.handwriting} onChange={value => save({ ...settings, privacy: { ...settings.privacy, handwriting: value } })} label="手写内容" /></div>
        <small className="aiOcrHint">题目始终以整卡识别文字发送；图片只可能是手写内容，且仅发送给分析模型，不会发给识别服务。</small>
      </div>
      <div className="settingsGroup aiSubjectGroup"><h2>科目与学习集</h2>
        <div className="aiSubjectAdd"><input value={newSubject} onChange={event => setNewSubject(event.target.value)} placeholder="新科目名称" aria-label="新科目名称" /><button onClick={addSubject}>添加</button></div>
        {subjects.map(subject => { const key = `subject-${subject.id}`; return <article key={subject.id}>
          <button type="button" className="aiRow aiRowButton" aria-expanded={expandedKey === key} onClick={() => toggleEditor(key)}>
            <span className="aiRowMain"><strong>{subject.name}</strong><small>{subject.studySetIds.length} 个学习集 · {subject.schedule.enabled ? `按${AI_FREQUENCY_LABELS[subject.schedule.frequency] || "周"}间隔检查生成` : "未开启定期检查"}</small></span>
            <b>{expandedKey === key ? "收起" : "编辑"}</b>
          </button>
          {expandedKey === key && <div className="aiEditor">
            <label className="aiEditorField"><span>科目名称</span><input value={subject.name} onChange={event => patchSubject(subject.id, { name: event.target.value })} /></label>
            <div className="aiEditorField"><span>所属学习集（每个学习集只能归属一个科目）</span><div className="aiStudySets">{studySets.map(set => { const owner = subjects.find(item => item.id !== subject.id && item.studySetIds.includes(set.id)); return <label key={set.id} className={owner ? "owned" : ""}><input type="checkbox" disabled={!!owner} checked={subject.studySetIds.includes(set.id)} onChange={event => patchSubject(subject.id, { studySetIds: event.target.checked ? [...subject.studySetIds, set.id] : subject.studySetIds.filter(id => id !== set.id) })} /><span>{set.title}</span></label> })}</div></div>
            <div className="aiRow"><span className="aiRowMain"><strong>定期检查生成</strong><small>打开插件时按间隔检查；不会在后台准点运行，内容无变化不重复生成</small></span><AISwitch checked={subject.schedule.enabled} onChange={value => patchSubject(subject.id, { schedule: { ...subject.schedule, enabled: value } })} label="定期检查生成" /></div>
            {subject.schedule.enabled && <label className="aiEditorField"><span>检查间隔</span><select value={subject.schedule.frequency} onChange={event => patchSubject(subject.id, { schedule: { ...subject.schedule, frequency: event.target.value } })}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>}
            <div className="aiEditorActions"><button className="aiDangerButton" onClick={() => save({ ...settings, subjects: subjects.filter(item => item.id !== subject.id) })}>删除科目</button></div>
          </div>}
        </article> })}
        {!subjects.length && <small className="aiOcrHint">添加科目并把学习集归入其中，才能按科目生成总结。</small>}
      </div>
      {settings.enabled && <div className="settingsGroup aiAdvancedGroup"><h2>高级</h2>
        <section className="aiAdvancedSection aiPreparationSettings"><h3>错题题目准备</h3><QuestionPreparationWorkspace studySets={mistakeStudySets} ocrEngine={settings.ocrEngine} includeHandwriting={settings.privacy.handwriting} onStorageChanged={loadStorage} onStatus={setStatus} /></section>
        <section className="aiAdvancedSection aiStorageSettings"><h3>缓存与报告</h3><div className="aiStorageSummary"><span><strong>OCR 缓存</strong><small>API 缓存 {cacheStats?.ocrEntries || 0} · 已准备题目 {cacheStats?.preparedEntries || 0} · 报告 {cacheStats?.reportCount || 0}</small></span><button onClick={() => MNBridge.send("aiClearOCRCache").then(loadStorage)}>清空 OCR</button></div><OCRResultBrowser items={preparedQuestions} onStatus={setStatus} />{reportList.slice(0, 8).map(item => <article key={item.id}><span><strong>{item.subjectName}</strong><small>{new Date(item.createdAt).toLocaleDateString()}</small></span><button onClick={() => MNBridge.send("aiDeleteReport", { reportId: item.id }).then(loadStorage)}>删除</button></article>)}</section>
      </div>}
    </div>
  </section>
}

const MistakeListItem = React.memo(function MistakeListItem({ item, selected, selectable, checked, onPreview, onToggle }) {
  const manualTags = Array.from(new Set(manualTagsOf(item).map(tag => String(tag).trim().replace(/^#+/, "")).filter(Boolean)))
  const reviewState = compactReviewStatus(item)
  return <div role="button" tabIndex={0} className={`mistakeItem ${selected ? "selected" : ""} ${checked ? "checked" : ""} ${selectable ? "selectable" : ""} ${item.noteAvailable ? "" : "unavailable"}`} onClick={onPreview} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPreview() } }}>{selectable && <AnimatedCheckbox className="batchCheckControl" label={`选择 ${item.sourceTitle}`} checked={checked} onChange={onToggle} />}<span className="mistakeItemBody"><span className="mistakeTitleRow"><strong>{item.sourceTitle}</strong><span className={`level level${item.level}`}>{levelNames[item.level]}</span></span><small className="mistakeSourceLine">{item.categoryLabel}{item.noteAvailable ? "" : " · 原卡片不可用"}</small><span className={`mistakeItemFooter ${manualTags.length ? "hasTags" : "noTags"}`}><small className={`mistakeReviewState ${reviewState === "已逾期" ? "overdue" : item.reviewCompleted ? "completed" : ""}`}>{reviewState}</small>{item.favorite === true && <><span className="mistakeMetaDivider" aria-hidden="true">·</span><span className="mistakeFavoriteSlot" title="已收藏"><span className="mistakeFavoriteMark"><Icon name="star" /></span><span className="mistakeFavoriteText">已收藏</span></span></>}{manualTags.length > 0 && <span className="mistakeMetaDivider" aria-hidden="true">·</span>}<span className="mistakeItemTags">{manualTags.map(tag => <em key={tag}>#{tag}</em>)}</span></span></span></div>
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
      return <li key={`${entry.at}:${position.index}`} style={{ left: `${position.x}px`, top: `${position.y}px` }}><span className="previewTimelineBody"><b className={`level${entry.level}`}>{levelNames[entry.level] || levelNames[0]}</b></span><i className={`previewTimelineDot level${entry.level}`} /><small className="previewTimelineDate">{formatDate(entry.at)}</small></li>
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
    {answer ? <div className="reviewAnswerViewport"><CardPreview key={`${answer.id || answerIndex}`} title={`${title}答案`} html={answer.html} zoom={answerZoom} onZoom={setAnswerZoom} /></div> : <Empty title={detail.answerStatus === "unbound" ? "来源脑图尚未绑定答案" : "没有匹配到答案"} text="答案按原题脑图当前绑定实时查询。" />}
  </div>
}

function retainReviewDetail(current, recordId, detail) {
  const next = { ...current }
  delete next[recordId]
  next[recordId] = detail
  while (Object.keys(next).length > 6) delete next[Object.keys(next)[0]]
  return next
}

function DueReviewList({ records, reviewCurves, action, manualTodayIds, setManualTodayIds, showLocateHint, focusRecordId, onRecordChanged }) {
  const [answerDetail, setAnswerDetail] = useState(null)
  const [answerLoadingId, setAnswerLoadingId] = useState("")
  const [activeFilter, setActiveFilter] = useState("today")
  const [historyOpen, setHistoryOpen] = useState({})
  const [feedbackById, setFeedbackById] = useState({})
  const [levelFilter, setLevelFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [queueNotice, setQueueNotice] = useState("")
  const [detailsById, setDetailsById] = useState({})
  const [questionsById, setQuestionsById] = useState({})
  const [questionErrorsById, setQuestionErrorsById] = useState({})
  const [questionLoadRevision, setQuestionLoadRevision] = useState(0)
  const [questionOpenById, setQuestionOpenById] = useState({})
  const [jumpHighlightedId, setJumpHighlightedId] = useState("")
  const detailLoadingRef = useRef(new Set())
  const detailCache = useMemo(() => createReviewDetailCache(recordId => MNBridge.send("mistakeDetail", { recordId })), [])
  const questionCache = useMemo(() => createReviewDetailCache(recordId => MNBridge.send("mistakeQuestion", { recordId })), [])
  const mountedRef = useRef(true)
  const questionOpenRef = useRef(questionOpenById)
  questionOpenRef.current = questionOpenById
  const reviewPageRef = useRef(null)


  useEffect(() => () => { mountedRef.current = false }, [])

  useEffect(() => {
    if (reviewPageRef.current) reviewPageRef.current.scrollTop = 0
  }, [])



  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const endToday = startToday + 86400000
  const statusOf = item => item.reviewCompleted ? "completed"
    : new Date(item.nextReviewAt).getTime() < startToday ? "overdue"
      : new Date(item.nextReviewAt).getTime() < endToday ? "today" : "upcoming"
  useEffect(() => {
    const item = records.find(record => record.recordId === focusRecordId)
    if (!item) return
    setActiveFilter(statusOf(item))
    setLevelFilter("all")
    setCategoryFilter("all")
  }, [focusRecordId])
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
  }, [focusRecordId, activeFilter])
  const manualTodaySet = new Set(manualTodayIds)
  // 记录被改级或复习后不再是逾期状态时，把它从手动补入的今日队列里移除。
  useEffect(() => {
    setManualTodayIds(current => current.length
      ? current.filter(recordId => {
        const item = records.find(record => record.recordId === recordId)
        return item && statusOf(item) === "overdue"
      })
      : current)
  }, [records])
  const statusMatches = item => activeFilter === "today"
    ? statusOf(item) === "today" || manualTodaySet.has(item.recordId)
    : activeFilter === "overdue"
      ? statusOf(item) === "overdue" && !manualTodaySet.has(item.recordId)
      : statusOf(item) === activeFilter
  const categories = Array.from(new Set(records.map(item => item.categoryPath?.[0] || item.sourceNotebookTitle).filter(Boolean)))
  const counts = {
    today: records.filter(item => statusOf(item) === "today" || manualTodaySet.has(item.recordId)).length,
    overdue: records.filter(item => statusOf(item) === "overdue" && !manualTodaySet.has(item.recordId)).length,
    upcoming: records.filter(item => statusOf(item) === "upcoming").length,
    completed: records.filter(item => statusOf(item) === "completed").length
  }
  const visibleRecords = records.filter(item => statusMatches(item) &&
    (levelFilter === "all" || String(item.level) === levelFilter) &&
    (categoryFilter === "all" || (item.categoryPath?.[0] || item.sourceNotebookTitle) === categoryFilter))
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
      void questionCache.get(recordId, version).then(question => {
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
        if (mountedRef.current && questionOpenRef.current[recordId] === true) setQuestionErrorsById(current => ({
          ...current,
          [recordId]: String(error?.message || error || "读取失败")
        }))
      }).finally(() => { detailLoadingRef.current.delete(recordId) })
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
    const curve = reviewCurves?.[level] || defaultReviewCurves[level]
    const index = level === item.level ? Math.min(item.reviewCount + 1, curve.length - 1) : 0
    return Number(curve[index]) || defaultReviewCurves[level][0]
  }

  function endsReview(item, level) {
    return level === 2 && item.level === 2
  }

  async function toggleAnswer(recordId) {
    if (answerDetail?.record?.recordId === recordId) {
      setAnswerDetail(null)
      return
    }
    setAnswerLoadingId(recordId)
    try {
      const record = records.find(item => item.recordId === recordId)
      const detail = detailsById[recordId] || await detailCache.get(recordId, record?.updatedAt || "")
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
    setManualTodayIds(current => current.filter(recordId => recordId !== item.recordId))
  }

  async function resume(item) {
    const result = await action("resumeMistakeReview", { recordId: item.recordId })
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

  function addOverdue(count) {
    const pool = records.filter(item => statusOf(item) === "overdue" && !manualTodaySet.has(item.recordId))
    const picked = [...pool].sort(() => Math.random() - .5).slice(0, count)
    if (!picked.length) {
      setQueueNotice("逾期池已经清空。")
      return
    }
    setManualTodayIds(current => [...new Set([...current, ...picked.map(item => item.recordId)])])
    setQueueNotice(`已从逾期池加入 ${picked.length} 道题到今日队列。`)
  }

  const summary = [
    ["今日待复测", counts.today, "按计划进入今日队列"],
    ["已经逾期", counts.overdue, "可随机补入今日任务"],
    ["未来计划", counts.upcoming, "允许提前复测"],
    ["已结束", counts.completed, "掌握并结束自动提醒"]
  ]

  return <section className="reviewPage" ref={reviewPageRef}>
    <div className="reviewSummary" aria-label="复习计划概览">{summary.map(([label, count, note], index) => <article className={index === 3 ? "completed" : ""} key={label}><span>{label}</span><strong>{count}</strong><small>{note}</small></article>)}</div>
    <div className="reviewToolbar"><nav aria-label="计划到期状态">{[
      ["today", "今日到期"], ["overdue", "已逾期"], ["upcoming", "未到期"], ["completed", "已结束"]
    ].map(([key, label]) => <button aria-pressed={activeFilter === key} className={activeFilter === key ? "active" : ""} key={key} onClick={() => setActiveFilter(key)}>{label}<b>{counts[key]}</b></button>)}</nav><div><select aria-label="题目分类" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">全部分类</option>{categories.map(category => <option key={category}>{category}</option>)}</select><select aria-label="掌握等级" value={levelFilter} onChange={event => setLevelFilter(event.target.value)}><option value="all">全部等级</option>{levelNames.map((name, level) => <option value={level} key={name}>{name}</option>)}</select></div></div>
    {activeFilter === "today" && <div className="reviewOverdueTools"><span><strong>今日任务量不够？</strong> 从逾期池随机补充：</span>{[1, 3, 5].map(count => <button type="button" key={count} onClick={() => addOverdue(count)}>+{count} 题</button>)}</div>}
    {queueNotice && <div className="reviewQueueNotice" role="status">{queueNotice}</div>}
    <div className="reviewQueueHeading"><span><strong>{{ today: "今日队列", overdue: "逾期计划", upcoming: "未来计划", completed: "已结束" }[activeFilter]}</strong><small>完成评价后立即显示下次复习日期</small></span><div className="reviewQueueTools"><b>{visibleRecords.length} 道</b><button type="button" disabled={!visibleRecords.length} onClick={toggleAllQuestions}><MorphIcon from="collapse" to="expand" active={!allQuestionsOpen} />{allQuestionsOpen ? "收起全部题目" : "展开全部题目"}</button></div></div>
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
      const schedule = completed ? "掌握 · 连续 2 次确认" : `第 ${item.reviewCount + 1} 次复测 · ${dueText}`
      return <article data-review-id={item.recordId} tabIndex={-1} className={`dueReviewItem ${jumpHighlightedId === item.recordId ? "jumpHighlighted" : ""}`} key={item.recordId}>
        <div className="dueReviewSummary">
          <span className={`level level${item.level}`}>{levelNames[item.level]}</span>
          <span><strong>{item.sourceTitle}</strong><small>{item.categoryLabel}</small>{tags.length > 0 && <span className="reviewTags" aria-label="错题标签">{tags.map(tag => <em key={tag}>{tag}</em>)}</span>}</span>
          <span className="reviewCardTopActions"><small className={`reviewSchedule ${statusOf(item) === "overdue" ? "overdue" : ""}`}>{schedule}</small><button type="button" className="questionFoldButton" aria-label={questionOpen ? `收起 ${item.sourceTitle} 的题目预览` : `展开 ${item.sourceTitle} 的题目预览`} aria-expanded={questionOpen} onClick={() => toggleQuestion(item.recordId)}><MorphIcon from="collapse" to="expand" active={!questionOpen} /></button></span>
        </div>
        {feedbackById[item.recordId] && <div className="reviewCardFeedback" role="status">{feedbackById[item.recordId]}</div>}
        {questionOpen && <section className="reviewQuestion" aria-label="完整原题"><span>完整原题</span>{questionDetail ? <CardPreview title={`${item.sourceTitle}完整原题`} html={questionDetail.questionHtml} initialAutoHeight /> : questionError ? <div className="reviewQuestionLoading reviewQuestionError">读取完整原题失败。<button type="button" onClick={() => retryQuestion(item.recordId)}>重试</button></div> : <div className="reviewQuestionLoading">正在读取完整原题…</div>}</section>}
        <div className="dueReviewActions">
          <LocateButton className="reviewLocateAction" locateKey={`mistake:${item.recordId}`} onWaiting={() => showLocateHint("正在切换学习集并定位原题，请稍候…")} onLocate={async () => {
            const located = await action("openSource", { recordId: item.recordId }, false)
            if (located?.locateHint) showLocateHint(located.locateHint)
            return located
          }}><span className="reviewActionText reviewLocateText">定位原题</span></LocateButton>
          <button className={`reviewAnswerAction ${expanded ? "active" : ""}`} disabled={answerLoadingId === item.recordId} onClick={() => toggleAnswer(item.recordId)}><MorphIcon from="eye" to="eyeOff" active={expanded} /><span className="reviewActionText reviewAnswerText">{answerLoadingId === item.recordId ? "读取答案…" : expanded ? "收起答案" : "查看答案"}</span></button>
          <button className={`reviewHistoryAction ${historyOpen[item.recordId] ? "active" : ""}`} onClick={() => setHistoryOpen(current => ({ ...current, [item.recordId]: !current[item.recordId] }))}><MorphIcon from="history" to="collapse" active={!!historyOpen[item.recordId]} /><span className="reviewActionText reviewHistoryText">{historyOpen[item.recordId] ? "收起复测历史" : `复测历史 (${item.history?.length || 0})`}</span></button>
          {completed ? <><button onClick={() => resume(item)}>恢复复习计划</button><strong className="reviewEnded">✓ 已结束</strong></> : <div className="reviewResults" role="group" aria-label="本次复测结果">{levelNames.map((name, level) => <button data-level={level} key={name} onClick={() => complete(item, level)}>{name}<small>{endsReview(item, level) ? "结束" : `+${nextDays(item, level)} 天`}</small></button>)}</div>}
        </div>
        {expanded && <ReviewAnswer key={item.recordId} detail={answerDetail} title={item.sourceTitle} />}
        {historyOpen[item.recordId] && <div className="reviewHistory"><strong>复测历史</strong>{item.history?.length ? <ReviewTimeline history={item.history} gapForIndex={historyGap} /> : <small>暂无复测记录</small>}</div>}
      </article>
    })}
    </div>
  </section>
}


function MistakeDetail({ detail, customCategories, action, reloadDetail, onRemoved, showLocateHint, onReview }) {
  const [view, setView] = useState("question")
  const [answerIndex, setAnswerIndex] = useState(0)
  const [tags, setTags] = useState([])
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [newTag, setNewTag] = useState("")
  const [removeArmed, setRemoveArmed] = useState(false)
  const [deleteTagTarget, setDeleteTagTarget] = useState("")
  const [levelNotice, setLevelNotice] = useState("")
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [tagsCrowded, setTagsCrowded] = useState(false)
  const bar = useDockableBar()
  const tagPickerRef = useRef(null)
  const tagTriggerRef = useRef(null)
  const tagMenuRef = useRef(null)
  const tagMenuPos = useAnchoredPopover(tagPickerOpen, tagTriggerRef, 280, "end")
  useScrollDismiss(tagPickerOpen, () => setTagPickerOpen(false), tagMenuRef)
  const detailTagSignature = manualTagsOf(detail.record).join("\u001f")
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
  useLayoutEffect(() => {
    const trigger = tagTriggerRef.current
    if (!trigger) return undefined
    const measure = () => {
      const lineHeight = Math.max(16, parseFloat(getComputedStyle(trigger).lineHeight) || 20)
      const rows = Math.round(trigger.scrollHeight / lineHeight)
      setTagsCrowded(current => current ? rows > 1 : rows >= 3)
    }
    measure()
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null
    observer?.observe(trigger)
    return () => observer?.disconnect()
  }, [detail.record.recordId, tags.join("\u001f")])
  useEffect(() => {
    if (!tagPickerOpen) return undefined
    const close = event => {
      if (!tagPickerRef.current?.contains(event.target) && !tagMenuRef.current?.contains(event.target)) setTagPickerOpen(false)
    }
    document.addEventListener("pointerdown", close, true)
    return () => document.removeEventListener("pointerdown", close, true)
  }, [tagPickerOpen])
  const answer = detail.answers?.[Math.min(answerIndex, Math.max(0, detail.answers.length - 1))]
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
  return <div className="detail">
    <div className="detailHeader"><div className={`detailHeadingBlock ${tagsCrowded ? "tagsCrowded" : ""}`}>
      <div className="preview-detail-source-row"><small className="preview-studyset-name">{detail.record.sourceNotebookTitle}</small><span className="preview-detail-source-path">{(detail.record.sourcePathTitles || []).join(" › ") || "脑图根节点"}</span><span className="detailAddedDate" title={`添加于 ${formatDate(detail.record.createdAt)}`}>{formatDate(detail.record.createdAt)}</span></div>
      <div className="preview-detail-title-row"><h2>{detail.record.sourceTitle}</h2>
        {/* 大胶囊：等级 | 剩余天数，竖线分隔、两侧各按各的状态上色；透明 select 覆盖等级半区用于改等级 */}
        <div className="detailStatusCard">
          <span className={`detailLevelChip level level${detail.record.level}`} title="点击调整等级">
            {levelNames[detail.record.level]}
            <select className={`previewLevelSelect preview-level-${detail.record.level}`} value={detail.record.level} onChange={updateLevel} aria-label="修改错题等级">{levelNames.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
          </span>
          <span className="detailStatusDivider" aria-hidden="true" />
          <button type="button" className={`detailDueChip ${dueTone}`} onClick={() => onReview?.(detail.record.recordId)} title="查看该题复习记录">{reviewStatus}</button>
        </div>
    <div ref={tagPickerRef} className={`detailTagPicker detailTagBar ${tagPickerOpen ? "open" : ""}`}>
      <button ref={tagTriggerRef} type="button" className="detailTagBarTrigger" aria-label="编辑自定义标签" onClick={() => setTagPickerOpen(value => !value)} aria-expanded={tagPickerOpen} title={tags.length ? tags.map(tag => `#${tag}`).join(" ") : "添加自定义标签"}>
        {tags.map(tag => <em key={tag}>#{tag}</em>)}<DetailMorphIcon icon={Plus} target={ChevronDown} active={tagPickerOpen} />
      </button>
      {tagPickerOpen && tagMenuPos && createPortal(<div className="detailCategoryMenu" ref={tagMenuRef} style={POPOVER_ABSOLUTE(tagMenuPos)}><strong>自定义标签</strong><div className="detailCategoryOptions">{(customCategories || []).length ? (customCategories || []).map(tag => <div className="detailTagOptionRow" key={tag}><button type="button" role="checkbox" aria-checked={tags.includes(tag)} data-tag={tag} className={`detailTagOption ${tags.includes(tag) ? "checked" : ""}`} onClick={() => toggleTag(tag)}><i className="detailTagCheck" aria-hidden="true">{tags.includes(tag) ? "✓" : ""}</i><span>#{tag}</span></button><button type="button" className="detailTagDelete" title={`删除标签 #${tag}`} aria-label={`删除标签 ${tag}`} onClick={event => { event.stopPropagation(); setDeleteTagTarget(tag) }}><Icon name="trash" /></button></div>) : <small>暂无标签</small>}</div><div className="detailCategoryCreate"><input value={newTag} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") createTag() }} placeholder="新建标签" /><button type="button" onClick={createTag} disabled={!newTag.trim()}>新建</button></div></div>, document.body)}
    </div>
      </div>
    </div>
    </div>
    {levelNotice && <div className="levelChangeNotice" role="status" aria-live="polite">{levelNotice}</div>}
    <div className="detailStage" ref={bar.stageRef}>
      <div className="cardFrame">{view === "question" ? <CardPreview key={`${detail.record.recordId}:question`} title="错题原题" html={detail.questionHtml} onInteract={() => setTagPickerOpen(false)} /> : answer ? <CardPreview key={`${detail.record.recordId}:answer:${answer.id || answerIndex}`} title="错题答案" html={answer.html} onInteract={() => setTagPickerOpen(false)} /> : <Empty title={detail.answerStatus === "unbound" ? "尚未绑定答案脑图" : detail.answerStatus === "index-missing" ? "答案索引尚未建立" : "没有匹配答案"} text="可从经典菜单绑定答案脑图或刷新答案索引。" />}</div>
      {/* 悬浮操作条：停靠预览窗口边缘，可拖动吸附，横竖排布随边切换 */}
      <div ref={bar.controlRef} className={`detailDock ${bar.collapsed ? "isCollapsed" : ""} ${bar.dragging ? "dragging" : ""}`} style={bar.style} {...bar.handlers}>
      <div className={`detailActionBar ${bar.orientation}`} aria-hidden={bar.collapsed} inert={bar.collapsed}>
        <button aria-label="题目" className={view === "question" ? "active" : ""} onClick={() => { setView("question"); setTagPickerOpen(false) }}><DetailMorphIcon icon={FileQuestion} active={view === "question"} /><span className="barText" data-dock-label="question" data-hidden={bar.hiddenLabels.includes("question") || undefined}>题目</span></button>
        <button aria-label="答案" className={view === "answer" ? "active" : ""} onClick={() => { setView("answer"); setTagPickerOpen(false) }}><DetailMorphIcon icon={FileCheck} active={view === "answer"} /><span className="barText" data-dock-label="answer" data-hidden={bar.hiddenLabels.includes("answer") || undefined}>答案{detail.answers?.length > 1 ? ` (${detail.answers.length})` : ""}</span></button>
        {view === "answer" && detail.answers?.length > 1 && <label className="answerVariantControl"><span aria-hidden="true">{answerIndex + 1}</span><select aria-label="选择答案候选" className="answerVariantSelect" value={answerIndex} onChange={event => setAnswerIndex(Number(event.target.value))}>{detail.answers.map((item, index) => <option key={item.id} value={index}>{item.title} · {item.path}</option>)}</select></label>}
        <FavoriteButton favorite={detail.record.favorite === true} busy={favoriteBusy} onToggle={toggleFavorite} />
        <LocateButton locateKey={`mistake:${detail.record.recordId}`} className="preview-locate-button" onWaiting={() => showLocateHint("正在切换学习集并定位原题，请稍候…")} onLocate={async () => {
              const located = await action("openSource", { recordId: detail.record.recordId }, false)
              if (located?.locateHint) showLocateHint(located.locateHint)
              return located
            }} settingsIcon ariaLabel="定位原题"><span className="barText" data-dock-label="locate" data-hidden={bar.hiddenLabels.includes("locate") || undefined}>定位</span></LocateButton>
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

function SettingsGroup({ title, items, tone = "accent" }) {
  return <div className="settingsGroup"><h2>{title}</h2><div>{items.map(([icon, name, description, onClick, trailing]) =>
    <button key={name} className={trailing ? "hasTrailing" : ""} onClick={onClick}><i><SFTileIcon name={icon} tone={tone} /></i><span><strong>{name}</strong><small>{description}</small></span>{trailing}</button>)}</div></div>
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
  const [include, setInclude] = useState({ question: true, answer: true, source: true, review: false })
  const [reviewDetail, setReviewDetail] = useState("summary")
  const [result, setResult] = useState("")
  const [answerLayout, setAnswerLayout] = useState("after-each")
  const [pageLayout, setPageLayout] = useState("auto")
  const [actualPreview, setActualPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [stoppingExport, setStoppingExport] = useState(false)
  const [reviewStatusFilter, setReviewStatusFilter] = useState("all")
  const [createdFilter, setCreatedFilter] = useState("all")
  const [tagFilter, setTagFilter] = useState("all")
  const [sortOrder, setSortOrder] = useState("current")
  const [exportQuery, setExportQuery] = useState("")
  const [exportLevel, setExportLevel] = useState("all")
  const [advancedOpen, setAdvancedOpen] = useState(false)
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
  const tagOptions = useMemo(() => Array.from(new Set(scopedRecords.flatMap(item => Array.isArray(item.manualCategories) ? item.manualCategories : item.manualCategory ? [item.manualCategory] : []).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN")), [scopedRecords])
  const exportCandidates = useMemo(() => {
    const filtered = availableRecords.filter(item => {
    const time = new Date(item.nextReviewAt).getTime()
    if (reviewStatusFilter === "today") return !item.reviewCompleted && time >= startToday && time < endToday
    if (reviewStatusFilter === "overdue") return !item.reviewCompleted && time < startToday
    if (reviewStatusFilter === "upcoming") return !item.reviewCompleted && time >= endToday
    if (reviewStatusFilter === "completed") return item.reviewCompleted === true
    return true
    }).filter(item =>
    (exportLevel === "all" || item.level === Number(exportLevel)) &&
    effectiveMapSet.has(sourceInsightKey(item))
    ).filter(item => {
      if (tagFilter !== "all") {
        const tags = Array.isArray(item.manualCategories) ? item.manualCategories : item.manualCategory ? [item.manualCategory] : []
        if (tagFilter === "untagged" ? tags.length : !tags.includes(tagFilter)) return false
      }
      if (createdFilter !== "all") {
        const created = new Date(item.createdAt).getTime()
        if (!Number.isFinite(created)) return false
        if (createdFilter === "today" && created < startToday) return false
        if (createdFilter === "7" && created < startToday - 6 * 86400000) return false
        if (createdFilter === "30" && created < startToday - 29 * 86400000) return false
      }
      return true
    }).filter(item => {
    const needle = normalizeSearch(exportQuery)
    return !needle || normalizeSearch([item.sourceTitle, item.sourceNotebookTitle, ...(item.sourcePathTitles || []), ...(item.manualCategories || []), item.manualCategory || ""].join(" ")).includes(needle)
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
  const activeFilterCount = [reviewStatusFilter !== "all", createdFilter !== "all", tagFilter !== "all", exportLevel !== "all", mapFilterActive, Boolean(exportQuery.trim())].filter(Boolean).length
  const filterSummary = [
    reviewStatusFilter !== "all" ? { today: "今日到期", overdue: "已逾期", upcoming: "未来复习", completed: "已结束" }[reviewStatusFilter] : "",
    createdFilter !== "all" ? { today: "今天添加", 7: "最近 7 天", 30: "最近 30 天" }[createdFilter] : "",
    exportLevel !== "all" ? levelNames[Number(exportLevel)] : "",
    tagFilter !== "all" ? (tagFilter === "untagged" ? "无标签" : `#${tagFilter}`) : "",
    effectiveMapKeys.length !== mindMaps.length ? `${effectiveMapKeys.length} 个脑图` : "",
    exportQuery.trim() ? `“${exportQuery.trim()}”` : ""
  ].filter(Boolean)

  function estimatePages() {
    if (!selected.length) return 0
    if (pageLayout === "compact") {
      const pages = Math.ceil(selected.length / (include.answer && answerLayout === "after-each" ? 5 : 10))
      return include.answer && answerLayout === "end" ? pages + Math.ceil(selected.length / 20) : pages
    }
    const perPage = pageLayout === "one-per-page" ? 1 : pageLayout === "two-per-page" ? 2 : pageLayout === "three-per-page" ? 3 : 2
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
    return { format, filename, recordIds: selected.map(item => item.recordId), answerLayout, pageLayout, reviewDetail, include }
  }

  async function runPreview(full = false) {
    const signature = previewSignatureRef.current
    setResult("")
    setPreviewLoading(true)
    try {
      const payload = { ...exportPayload(), previewLimit: full ? undefined : 3 }
      const response = await action("previewMistakeExport", payload, false)
      // 发起后筛选/设置又变过：过期响应直接丢弃，不允许旧预览覆盖新设置
      if (previewSignatureRef.current !== signature) return
      if (response?.pdfUrl || response?.html || response?.markdown) {
        setActualPreview(response)
        if (response?.truncated) setResult(`快速预览仅渲染前 ${response.previewCount} 题（共 ${response.count} 道）；点「完整预览」生成全部。`)
      }
    } finally {
      setPreviewLoading(false)
    }
  }

  // PDF 导出任务式：受理后轮询进度，前端 30s 超时不再掐断长任务
  const taskActive = pdfTask && (pdfTask.status === "rendering" || pdfTask.status === "saving")

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
        setPdfTask(null)
        setResult("无法获取导出任务状态，原生任务可能仍在后台，请重进导出页查看")
        return
      }
      if (token !== pdfTaskPollRef.current) return
      if (!status?.exists) { setPdfTask(null); return }
      setPdfTask(current => ({ ...(current || { id }), status: status.status, progress: status.progress, pages: status.pages, error: status.error }))
      if (status.status === "saved") { setResult(`PDF 已生成（${status.pages || "?"} 页），已打开系统保存面板`); setPdfTask(null); return }
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
    await action("pdfTaskCancel", { id: pdfTask.id }, false)
    setPdfTask(null)
    setStoppingExport(false)
    setResult("已停止导出")
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
        await action("pdfTaskCancel", { id: response.taskId }, false)
        setStoppingExport(false)
        setResult("已停止导出")
        return
      }
      if (response?.saved) { setResult(`已打开系统另存面板：${response.filename}（${response.count} 道）`); return }
      if (response?.printCompleted) { setResult(`已生成 ${response.filename}（浏览器预览模拟，共 ${response.count} 道）`); return }
      if (response?.taskAccepted) {
        setPdfTask({ id: response.taskId, status: response.status || "rendering", progress: response.progress || 5 })
        pollPdfTask(response.taskId)
      }
    } finally {
      setExportLoading(false)
      if (!exportCancelRequestedRef.current) setStoppingExport(false)
    }
  }

  function resetFilters() {
    setReviewStatusFilter("all")
    setCreatedFilter("all")
    setTagFilter("all")
    setExportLevel("all")
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
        if (status?.exists && !status.preview && (status.status === "rendering" || status.status === "saving")) {
          setPdfTask({ id: status.id, status: status.status, progress: status.progress })
          pollPdfTask(status.id)
        }
      } catch { /* 忽略 */ }
    }
    void resume()
    return () => { cancelled = true; pdfTaskPollRef.current += 1 }
  }, [])

  const contentOptions = [
    ["question", "完整原题", "题干、图片与手写内容"],
    ["answer", "实时匹配答案", "按当前答案脑图重新匹配"],
    ["source", "来源路径", "学习集、脑图与章节路径"],
    ["review", "复习信息", "等级、时间与复习次数"]
  ]
  const canSubmit = selected.length > 0 && Object.values(include).some(Boolean)
  const pageLabel = { auto: "自动分页", "one-per-page": "一页一题", "two-per-page": "一页两题", "three-per-page": "一页三题", compact: "紧凑 · 约10题/页" }[pageLayout]
  const answerLabel = answerLayout === "end" ? "答案文末集中" : "答案紧随题目"
  const exportInProgress = exportLoading || taskActive
  const exportProgress = Math.max(4, Math.min(100, Number(pdfTask?.progress) || (pdfTask?.status === "saving" ? 96 : exportLoading ? 6 : 32)))
  const exportProgressLabel = stoppingExport
    ? "正在停止导出…"
    : pdfTask?.status === "saving"
      ? "PDF 已生成，正在打开保存面板…"
      : taskActive
        ? "正在生成 PDF…"
        : "正在准备导出内容…"

  return <section className="exportPage exportRedesign" ref={exportPageRef}>
    <header className="exportPageHeader"><button type="button" className="exportBackButton" onClick={onBack}><Icon name="left" /> 返回</button><span><h1>导出错题</h1></span></header>
    <div className="exportLayout">
      <div className="exportComposer">
        <ExportSection step="1" title="筛选题目" description="符合下列条件的可用错题将全部导出。" trailing={<button type="button" className="exportResetButton" disabled={!activeFilterCount} onClick={resetFilters}>重置筛选{activeFilterCount ? ` (${activeFilterCount})` : ""}</button>}>
          <label className="exportSearchField"><span>搜索题目</span><input value={exportQuery} onChange={event => setExportQuery(event.target.value)} placeholder="标题、脑图、章节或标签" /></label>
          <div className="exportPrimaryFilters"><label><span>复习状态</span><select value={reviewStatusFilter} onChange={event => setReviewStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="today">今日到期</option><option value="overdue">已逾期</option><option value="upcoming">未来复习</option><option value="completed">已结束复习</option></select></label><label><span>错题等级</span><select value={exportLevel} onChange={event => setExportLevel(event.target.value)}><option value="all">全部等级</option>{levelNames.map((name, level) => <option key={level} value={String(level)}>{name}</option>)}</select></label><label><span>学习集 / 脑图</span>{mindMaps.length ? <MindMapMultiSelect options={mindMaps} selectedKeys={effectiveMapKeys} setSelectedKeys={setSelectedMapKeys} title="筛选脑图" allowEmpty emptyLabel="请选择脑图" /> : <small className="exportEmptyValue">暂无脑图</small>}</label></div>
          <button type="button" className="exportDisclosure" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(value => !value)}><span><strong>更多筛选与排序</strong><small>添加时间、标签和导出顺序</small></span><Icon name={advancedOpen ? "up" : "down"} /></button>
          {advancedOpen && <div className="exportAdvancedFilters"><label><span>添加时间</span><select value={createdFilter} onChange={event => setCreatedFilter(event.target.value)}><option value="all">不限时间</option><option value="today">今天添加</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></label><label><span>自定义标签</span><select value={tagFilter} onChange={event => setTagFilter(event.target.value)}><option value="all">全部标签</option><option value="untagged">无标签</option>{tagOptions.map(tag => <option key={tag}>{tag}</option>)}</select></label><label><span>导出顺序</span><select value={sortOrder} onChange={event => setSortOrder(event.target.value)}><option value="current">错题本当前顺序</option><option value="created-desc">最近添加优先</option><option value="due-asc">最早到期优先</option><option value="level">按错题等级</option><option value="source">按来源路径</option></select></label></div>}
          <div className={`exportSelectionResult ${selected.length ? "ready" : "empty"}`}><span>{!effectiveMapKeys.length ? "请选择至少一个学习集 / 脑图" : `筛选得到 ${selected.length} 道可用错题`}</span>{filterSummary.length > 0 && <span className="exportFilterTokens">{filterSummary.map(text => <em key={text}>{text}</em>)}</span>}</div>
        </ExportSection>

        <ExportSection step="2" title="选择内容" description="决定每道题在导出文件中包含什么。">
          <div className="exportContentChoices">{contentOptions.map(([key, label, detail]) => <label key={key} className={include[key] ? "selected" : ""}><AnimatedCheckbox checked={include[key]} label={label} onChange={() => toggle(key)} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</div>
          {include.review && <label className="exportInlineSetting"><span><strong>复习信息详细程度</strong><small>概要更适合打印，完整历史适合归档。</small></span><select value={reviewDetail} onChange={event => setReviewDetail(event.target.value)}><option value="summary">概要</option><option value="full">完整历史</option></select></label>}
          {!Object.values(include).some(Boolean) && <p className="exportInlineWarning">请至少选择一项导出内容。</p>}
        </ExportSection>

        <ExportSection step="3" title="设置文件" description="选择格式；PDF 可继续设置题目密度与答案位置。">
          <div className="formatChoices exportFormatChoices"><button type="button" className={format === "pdf" ? "selected" : ""} aria-pressed={format === "pdf"} onClick={() => setFormat("pdf")}><b>PDF</b><span><strong>打印与练习</strong><small>保留图片、手写和书写区</small></span></button><button type="button" className={format === "md" ? "selected" : ""} aria-pressed={format === "md"} onClick={() => setFormat("md")}><b>MD</b><span><strong>编辑与归档</strong><small>Markdown 正文和 assets 图片</small></span></button></div>
          {format === "pdf" && <div className="exportPdfSettings"><span className="exportControlLabel">每页题目密度</span><ExportSegmented label="每页题目密度" value={pageLayout} onChange={setPageLayout} options={[{ value: "auto", label: "自动", detail: "按内容分页" }, { value: "one-per-page", label: "1 题", detail: "留白最多" }, { value: "two-per-page", label: "2 题", detail: "均衡" }, { value: "three-per-page", label: "3 题", detail: "宽松" }, { value: "compact", label: "紧凑", detail: "约 10 题/页" }]} />{include.answer && <><span className="exportControlLabel">答案位置</span><ExportSegmented label="答案位置" value={answerLayout} onChange={setAnswerLayout} options={[{ value: "after-each", label: "紧随题目", detail: "核对更直接" }, { value: "end", label: "文末集中", detail: "适合整套练习" }]} /></>}</div>}
          <label className="exportFilenameField"><span>文件名</span><div className="filenameInput"><input value={filename} onChange={event => setFilename(event.target.value)} /><b>{format === "md" ? ".zip" : ".pdf"}</b></div></label>
        </ExportSection>

        {exportInProgress ? <div className="exportCommitBar exportCommitProgress" role="status" aria-live="polite"><span className="exportProgressCopy"><strong>{exportProgressLabel}</strong><small>{pdfTask?.pages > 0 ? `${pdfTask.pages} 页` : `${selected.length} 道题`} · {Math.round(exportProgress)}%</small></span><span className="exportProgressTrack" role="progressbar" aria-label="导出进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(exportProgress)}><i style={{ width: `${exportProgress}%` }} /></span><button type="button" className="exportStopButton" onClick={cancelPdfTask} disabled={stoppingExport}>停止导出</button></div> : <div className="exportCommitBar" role="status"><span className="exportCountBadge"><strong>{selected.length}</strong><small>道将导出</small></span><span className="exportCommitSummary"><strong>{canSubmit ? "筛选结果已准备好" : selected.length ? "请选择导出内容" : "当前没有可导出的题目"}</strong><small>{filterSummary.length ? filterSummary.join(" · ") : "未添加额外筛选"}{invalidCount ? ` · 已排除 ${invalidCount} 道失效记录` : ""} · {format === "pdf" ? `${pageLabel} · ${include.answer ? answerLabel : "不含答案"} · 预计约 ${estimatePages()} 页` : "Markdown + assets"}</small></span><div><button className="exportPreviewButton" disabled={!canSubmit || previewLoading} onClick={() => runPreview(false)}><Icon name="eye" /> {previewLoading ? "正在生成…" : actualPreview ? "更新预览" : "快速预览"}</button><button className="exportPrimary" disabled={!canSubmit || previewLoading} onClick={runExport}><Icon name="download" /> 导出文件</button></div></div>}
        {result && <p className="exportResult" role="status">{result}</p>}
      </div>

      <aside className={`exportPreview ${actualPreview ? "hasPreview" : ""}`}><header><span><strong>导出预览</strong><small>{format === "pdf" ? `A4 · ${pageLabel} · ${include.answer ? answerLabel : "不含答案"}` : "Markdown 文档"}</small></span><b>{actualPreview?.pages ? `${actualPreview.pages} 页` : `${selected.length} 道`}</b></header>{actualPreview?.previewPages?.length ? <div className="actualPreviewViewport actualPreviewPages">{actualPreview.previewPages.map((page, index) => <figure key={`${page}:${index}`}><img src={page} alt={`PDF 第 ${index + 1} 页`} /><figcaption>第 {index + 1} 页</figcaption></figure>)}</div> : actualPreview?.html ? <ExportHtmlPreview html={actualPreview.html} /> : actualPreview?.pdfUrl ? <div className="actualPreviewViewport"><iframe title="实际 PDF 导出预览" src={actualPreview.pdfUrl} /></div> : actualPreview?.markdown ? <div className="actualMarkdownPreview markdownPreview" dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(actualPreview.markdown) }} /> : <div className="actualPreviewEmpty"><span className="exportPreviewGlyph"><Icon name="eye" /></span><strong>预览最终文件</strong><span>快速预览只生成前 3 道题，适合调整布局；完整文件会在导出时生成。</span><button type="button" disabled={!canSubmit || previewLoading || taskActive || exportLoading} onClick={() => runPreview(false)}>{previewLoading ? "正在生成预览…" : "生成快速预览"}</button></div>}</aside>
    </div>
  </section>
}

if (typeof document !== "undefined" && document.getElementById("root")) {
  createRoot(document.getElementById("root")).render(<App />)
}

// 供渲染冒烟测试（tests/web-render-smoke.test.ts）逐页签 renderToString；
// 生产入口不受影响，这些导出在打包时会被 tree-shake。
export {
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
  renderMarkdownPreview
}
