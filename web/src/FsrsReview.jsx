import React, { useEffect, useMemo, useRef, useState } from "react"
import MNBridge from "./lib/mnBridge"
import { reviewDayStatus } from "./lib/reviewQueueControls"
import { fsrsQueueRecord } from "./lib/fsrsQueue"
import "./ui/fsrs-controls.css"

export const feedbackNames = ["不会", "不熟", "良好", "掌握"]
const reasons = { concept: "概念不清", formula: "公式遗忘", approach: "思路受阻", calculation: "计算失误", reading: "审题遗漏", time: "时间不足" }

function ErrorEditor({ initial, busy, onSave, onCancel }) {
  const [selected, setSelected] = useState(initial?.errorReasons || [])
  const [note, setNote] = useState(initial?.errorNote || "")
  return <fieldset className="fsrsErrorEditor" disabled={busy}><legend>这次卡在哪里？<span>选填</span></legend>
    <div className="fsrsReasonOptions">{Object.entries(reasons).map(([key, label]) => <button type="button" key={key} aria-pressed={selected.includes(key)} onClick={() => setSelected(old => old.includes(key) ? old.filter(v => v !== key) : [...old, key])}>{label}</button>)}</div>
    <textarea aria-label="错因备注" maxLength={500} placeholder="补充一句，方便下次回顾…" value={note} onChange={e => setNote(e.target.value)} />
    <div className="fsrsEditorFooter"><span>{note.length}/500</span><button type="button" onClick={onCancel}>取消</button><button type="button" className="fsrsPrimary" onClick={() => onSave(selected, note)}>保存反馈</button></div>
  </fieldset>
}

/** Data/controller adapter only: the existing queue owns all page layout. */
export default function FsrsReview({ recordsRevision, sources, onDayCounts, children }) {
  const [data, setData] = useState(null), [error, setError] = useState("")
  const [busy, setBusy] = useState(false), [editor, setEditor] = useState(null), [manualIds, setManualIds] = useState([])
  const lock = useRef(false), retry = useRef({}), alive = useRef(true), serial = useRef(0)
  async function refresh() {
    const request = ++serial.current
    const value = await MNBridge.send("fsrsSnapshot")
    if (alive.current && request === serial.current) setData(value)
  }
  useEffect(() => { alive.current = true; refresh().catch(e => setError(e.message)); return () => { alive.current = false; serial.current++ } }, [recordsRevision])
  useEffect(() => {
    const visible = () => { if (!document.hidden && !lock.current) refresh().catch(e => setError(e.message)) }
    window.addEventListener("focus", visible); window.addEventListener("cardlink-fsrs-refresh", visible); document.addEventListener("visibilitychange", visible)
    return () => { window.removeEventListener("focus", visible); window.removeEventListener("cardlink-fsrs-refresh", visible); document.removeEventListener("visibilitychange", visible) }
  }, [])
  async function run(fn) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError("")
    try { return await fn() } catch (e) { if (alive.current) setError(String(e.message || e)) }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function submit(item, level, errorReasons, errorNote) {
    return run(async () => {
      const key = `${item.recordId}:${item.progress.revision}:${level}`
      const eventId = retry.current[key] ||= `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      const saved = await MNBridge.send("fsrsReview", { recordId: item.recordId, revision: item.progress.revision, eventId, rating: level + 1, errorReasons, errorNote })
      setEditor(null); await refresh(); return saved
    })
  }
  const records = useMemo(() => {
    const byId = new Map(sources.map(source => [source.recordId, source]))
    return (data?.records || []).map(item => fsrsQueueRecord(item, byId.get(item.recordId)))
  }, [data, sources])
  const day = new Date().toDateString()
  useEffect(() => {
    onDayCounts?.(data ? reviewDayStatus(records, manualIds).counts : null)
  }, [onDayCounts, data, records, manualIds, day])
  const adapter = {
    names: feedbackNames, busy: busy || !!editor, notice: error || (!data ? "正在读取复习记录…" : ""), manualTodayIds: manualIds,
    content: async recordId => ({ ...await MNBridge.send("fsrsContent", { recordId }), record: records.find(item => item.recordId === recordId) }),
    start: items => run(() => MNBridge.send("startFsrsReviewMode", { recordIds: items.filter(item => !item.reviewCompleted).map(item => item.recordId) })),
    review: (item, level) => level === 0 || level === 1 ? setEditor({ item, level }) : submit(item, level),
    resume: item => run(async () => { const result = await MNBridge.send("fsrsPause", { recordId: item.recordId, revision: item.progress.revision, paused: false }); await refresh(); return { nextReviewAt: result.card?.due || result.initialDue } }),
    addOverdue: count => { const start = new Date(); start.setHours(0, 0, 0, 0); const ids = records.filter(item => !item.reviewCompleted && Date.parse(item.nextReviewAt) < +start && !manualIds.includes(item.recordId)).sort(() => Math.random() - .5).slice(0, count).map(item => item.recordId); setManualIds(old => [...old, ...ids]); return { addedCount: ids.length } },
    editor: item => editor?.item.recordId === item.recordId ? <div className="reviewHistory"><ErrorEditor busy={busy} onCancel={() => setEditor(null)} onSave={(keys, note) => submit(editor.item, editor.level, keys, note)} /></div> : null,
    history: (item, renderTimeline) => <FsrsHistory key={`${item.recordId}:${item.progress.revision}`} item={item} renderTimeline={renderTimeline} run={run} refresh={refresh} busy={busy} />
  }
  return children({ records, adapter })
}

function FsrsHistory({ item, renderTimeline, run, refresh, busy }) {
  const [events, setEvents] = useState(null), [error, setError] = useState(""), [editing, setEditing] = useState(null)
  useEffect(() => { let active = true; MNBridge.send("fsrsHistory", { recordId: item.recordId }).then(value => { if (active) setEvents(value) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [item.recordId])
  if (error) return <small role="alert">{error}</small>
  if (!events) return <small>正在读取历史…</small>
  return <>{events.length ? renderTimeline(events.map(event => ({ ...event, level: event.rating - 1, label: feedbackNames[event.rating - 1] }))) : <small>暂无复测记录</small>}
    {events.length > 0 && <details className="fsrsHistoryDetails"><summary>错因与反馈更正</summary>{[...events].reverse().map(event => <div className="fsrsHistoryEntry" key={event.id}>
      <p>{new Date(event.at).toLocaleDateString("zh-CN")} · {feedbackNames[event.rating - 1]} · {(event.errorReasons || []).map(key => reasons[key]).join("、") || "错因未填写"} {event.errorNote}</p>
      <button className="fsrsTextButton" disabled={busy} onClick={() => setEditing(event)}>修改错因</button>
      {event.id === events[events.length - 1].id && <label> 更正末次反馈 <select aria-label="更正最后一次反馈" value={event.rating} disabled={busy} onChange={e => { const rating = Number(e.target.value); run(async () => { await MNBridge.send("fsrsCorrectFeedback", { recordId: item.recordId, eventId: event.id, revision: item.progress.revision, rating }); await refresh() }) }}>{feedbackNames.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>}
    </div>)}{editing && <ErrorEditor key={editing.id} initial={editing} busy={busy} onCancel={() => setEditing(null)} onSave={(errorReasons, errorNote) => run(async () => { await MNBridge.send("fsrsAmendErrors", { recordId: item.recordId, eventId: editing.id, revision: item.progress.revision, errorReasons, errorNote }); await refresh() })} />}</details>}
  </>
}

export function FsrsSettings({ Switch }) {
  const [options, setOptions] = useState(null), [editing, setEditing] = useState(false), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; MNBridge.send("fsrsGetOptions").then(value => { if (active) setOptions(value) }).catch(e => { if (active) setNotice(e.message) }); return () => { active = false } }, [])
  async function save() {
    setBusy(true)
    try { await MNBridge.send("fsrsSaveOptions", options); setEditing(false); setNotice("已保存；下次反馈生效，已有到期日不变。") } catch(e) { setNotice(e.message) } finally { setBusy(false) }
  }
  return <section className="fsrsSettingsPanel"><header><h2>复习间隔</h2><span>FSRS</span></header>
    {options && <div className="fsrsParameterList">
      <div className="fsrsParameterRow"><label htmlFor="fsrs-retention"><strong>目标保持率</strong><small>越高，复习通常越频繁</small></label>{editing ? <div className="fsrsNumberField"><input id="fsrs-retention" aria-label="目标保持率" disabled={busy} type="number" min="70" max="97" value={Math.round(options.retention * 100)} onChange={e => setOptions({ ...options, retention: Number(e.target.value) / 100 })} /><span>%</span></div> : <span className="fsrsParameterValue">{Math.round(options.retention * 100)}<small>%</small></span>}</div>
      <div className="fsrsParameterRow"><label htmlFor="fsrs-maximum"><strong>最大复习间隔</strong><small>下次复习最远可安排的天数</small></label>{editing ? <div className="fsrsNumberField"><input id="fsrs-maximum" aria-label="最大复习间隔" disabled={busy} type="number" min="1" max="36500" value={options.maximumInterval} onChange={e => setOptions({ ...options, maximumInterval: Number(e.target.value) })} /><span>天</span></div> : <span className="fsrsParameterValue">{options.maximumInterval.toLocaleString()}<small>天</small></span>}</div>
      <div className="fsrsParameterRow"><span><strong>分散复习日期</strong><small>轻微调整间隔，避免题目集中到期</small></span><button className="fsrsSwitchButton" type="button" role="switch" aria-label="分散复习日期" aria-checked={options.fuzz} disabled={!editing || busy} onClick={() => setOptions({ ...options, fuzz: !options.fuzz })}><Switch checked={options.fuzz} label="分散复习日期" /></button></div>
    </div>}
    <footer><small role="status">{notice || "参数调整在下次反馈后生效"}</small><button className="fsrsTextButton" disabled={!options || busy} onClick={() => editing ? save() : setEditing(true)}>{editing ? "保存设置" : "编辑"}</button></footer>
  </section>
}
