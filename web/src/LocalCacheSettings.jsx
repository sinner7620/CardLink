import CacheDonut from "./CacheDonut"
import "./ui/distribution-glow.css"
import "./ui/local-cache.css"
import React, { useEffect, useRef, useState } from "react"
import MNBridge from "./lib/mnBridge"

const categories = {
  indexes: { title: "答案索引", color: "#ff9500" },
  pdf: { title: "PDF 图片与预览", color: "#2fbe62" },
  logs: { title: "诊断日志", color: "#2fbe62" },
  templates: { title: "模板临时文件", color: "#2fbe62" },
  exports: { title: "导出文件", color: "#ff9500" },
  saved: { title: "手写与 AI", color: "#a64bd1" },
  dataBackups: { title: "插件数据备份", color: "#a64bd1" },
  ocrDatabase: { title: "OCR 数据库", color: "#55bce9" },
  ocrBackups: { title: "OCR 数据库备份", color: "#a64bd1" },
  updates: { title: "更新与恢复备份", color: "#a64bd1" },
  other: { title: "其他文件", color: "#55bce9" }
}
const temporaryColor = categories.pdf.color
const backupIds = new Set(["dataBackups", "ocrBackups", "updates"])
const temporaryIds = new Set(["pdf", "logs", "templates"])
const localDataIds = new Set(["indexes", "ocrDatabase", "saved"])
const measured = group => group.knownBytes ?? group.bytes ?? 0
export function formatCacheBytes(bytes) {
  if (!Number.isFinite(bytes)) return "大小未知"
  if (bytes === 0) return "0 B"
  const unit = Math.min(3, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1000))))
  return `${(bytes / 1000 ** unit).toLocaleString("en-US", { maximumFractionDigits: unit ? 1 : 0 })} ${["B", "KB", "MB", "GB"][unit]}`
}

export default function LocalCacheSettings() {
  const [groups, setGroups] = useState(null)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [cleared, setCleared] = useState(false)
  const [operation, setOperation] = useState(null)
  const [progress, setProgress] = useState(null)
  const confirmRef = useRef(null)
  const recycleRef = useRef(null)
  const requestBusy = useRef(false)
  const mounted = useRef(false)
  const eligible = (groups || []).filter(group => group.id !== "recycle" && !localDataIds.has(group.id) && !group.error && group.files > 0)
  const selectedIds = selected === null ? eligible.filter(group => group.clearable).map(group => group.id) : eligible.filter(group => selected.includes(group.id)).map(group => group.id)
  const chosen = eligible.filter(group => selectedIds.includes(group.id))
  const recycle = (groups || []).find(group => group.id === "recycle")
  const totalBytes = (groups || []).reduce((sum, group) => sum + measured(group), 0)
  const unknownSizes = (groups || []).some(group => group.bytes === null)
  const documentBytes = (groups || []).reduce((sum, group) => sum + (group.documentKnownBytes ?? group.documentBytes ?? 0), 0)
  const documentIncomplete = (groups || []).some(group => group.documentBytes === null)
  const selectedBytes = chosen.some(group => group.bytes === null) ? null : chosen.reduce((sum, group) => sum + group.bytes, 0)
  async function run(ids) {
    if (requestBusy.current) return
    requestBusy.current = true
    setBusy(true)
    setOperation(ids ? "clear" : "scan")
    setMessage("")
    setProgress(null)
    // Let the waiting state paint before a synchronous native scan starts.
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
    if (!mounted.current) { requestBusy.current = false; return }
    try {
      let task = await MNBridge.send(ids ? "clearLocalCache" : "scanLocalCache", ids ? { ids, allowRetained: chosen.some(group => !group.clearable) } : {})
      while (task.status === "running") {
        if (!mounted.current) return
        setOperation(task.operation)
        setProgress(task.progress)
        await new Promise(resolve => setTimeout(resolve, 200))
        if (!mounted.current) return
        task = await MNBridge.send("localCacheTaskStatus", { taskId: task.taskId })
      }
      if (!mounted.current) return
      if (task.status === "error") throw new Error(task.error || "缓存任务失败")
      const result = task.result
      setGroups(result.groups)
      setCleared(task.operation === "clear" && result.removed > 0 && !result.failed && !result.scanIncomplete && !result.skipped)
      if (task.operation === "clear") {
        const details = (result.failures || []).map(item => `${categories[item.category]?.title || item.category}：${item.reason}（${item.count} 个）`)
        setMessage([
          `已移入回收站 ${result.removed} 个文件，尚未释放空间`,
          result.failed ? `${result.failed} 个文件未能移入回收站${details.length ? "：" + details.join("；") : "，宿主没有提供失败原因"}` : "",
          result.skipped ? `已跳过 ${result.skipped} 个受保护的文件` : "",
          result.scanIncomplete ? "部分目录未能读取，统计不完整" : ""
        ].filter(Boolean).join("；"))
      }
    } catch (error) { if (mounted.current) setMessage(error?.message || String(error)) }
    finally { requestBusy.current = false; if (mounted.current) { setBusy(false); setOperation(null) } }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const backups = (groups || []).filter(group => backupIds.has(group.id)).sort((a, b) => measured(b) - measured(a))
  const temporary = (groups || []).filter(group => temporaryIds.has(group.id))
  const localData = (groups || []).filter(group => localDataIds.has(group.id))
  const exportsGroup = groups?.find(group => group.id === "exports")
  const other = groups?.find(group => group.id === "other" && (group.files || group.error))
  function sizeOf(items) {
    return `${items.some(item => item.bytes === null || item.error) ? "≥ " : ""}${formatCacheBytes(items.reduce((sum, item) => sum + measured(item), 0))}`
  }
  function selection(items) {
    const ids = items.filter(item => eligible.includes(item)).map(item => item.id)
    const count = ids.filter(id => selectedIds.includes(id)).length
    const all = ids.length > 0 && count === ids.length
    return {
      all, mixed: count > 0 && !all, disabled: busy || !ids.length,
      toggle: () => {
        setCleared(false)
        setSelected(all ? selectedIds.filter(id => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])])
      }
    }
  }
  function checkbox(state, label) {
    return <>
      <input type="checkbox" aria-label={label} checked={state.all} disabled={state.disabled}
        ref={node => { if (node) node.indeterminate = state.mixed }} onChange={state.toggle} />
      <span className={`cacheCategoryMark${state.all || state.mixed ? " checked" : ""}`} aria-hidden="true">
        {(state.all || state.mixed) && <svg viewBox="0 0 22 22"><path d={state.all ? "m6 11 3.5 3.5L16 8" : "M6 11h10"} /></svg>}
      </span>
    </>
  }
  function categoryRow(group) {
    const category = categories[group.id] || group
    return <label className="cacheCategory" key={group.id} style={{ "--cache-color": category.color }}>
      {checkbox(selection([group]), category.title)}
      <span className="cacheCategoryName">{category.title}{!group.clearable && <small>默认保留</small>}</span>
      <span className="cacheCategorySize">{group.error ? "不可读取" : sizeOf([group])}</span>
    </label>
  }
  const chartSegments = eligible.filter(group => !temporaryIds.has(group.id) && !backupIds.has(group.id)).map(group => ({
    id: group.id, title: categories[group.id]?.title || group.title, value: measured(group), order: measured(group),
    color: categories[group.id]?.color || "#8e8e93", selected: selectedIds.includes(group.id)
  }))
  for (const [id, title, items, color] of [
    ["temporary", "临时文件", temporary, temporaryColor],
    ["backups", "备份", backups, categories.ocrBackups.color]
  ]) {
    const value = items.filter(group => selectedIds.includes(group.id)).reduce((sum, group) => sum + measured(group), 0)
    const order = items.reduce((sum, group) => sum + measured(group), 0)
    chartSegments.push({ id, title, value, order, color, selected: value > 0 })
  }
  chartSegments.sort((a, b) => b.order - a.order)
  const waitingTitle = progress?.phase === "verify" ? "正在核对清理结果…" : progress?.phase === "clear" ? "正在移入回收站…" : operation === "clear" ? "正在查找待清理文件…" : "正在扫描本地缓存，请稍候…"
  const waitingDetail = progress?.phase === "clear" ? `已处理 ${progress.processed} / ${progress.total} 个文件，已移入 ${progress.removed} 个${progress.failed ? `，失败 ${progress.failed} 个` : ""}` : progress ? `已检查 ${progress.directories} 个目录，发现 ${progress.visited} 个文件，已统计 ${progress.processed} 个文件` : "正在准备，请稍候"
  return <section className="localCacheSettings" aria-label="缓存清理" aria-busy={busy}>
    {busy && <div className="cacheTaskOverlay" role="status" aria-live="polite" aria-label="缓存任务进度"><div className="cacheTaskCard"><i className="cacheTaskSpinner" aria-hidden="true" /><strong>{waitingTitle}</strong><p>{waitingDetail}</p>{progress?.phase === "clear" && progress.total > 0 && <progress aria-label="文件清理进度" max={progress.total} value={progress.processed} />}</div></div>}
    <div className="cacheStorageLayout">
      <div className="cacheStorageSummary">
        <div>
          <h3 className="cacheLocalTotal">{groups ? `本地占用${unknownSizes ? " ≥" : ""} ${formatCacheBytes(totalBytes)}` : "本地占用"}</h3>
          {groups && <p>文档目录小计{documentIncomplete ? " ≥" : ""} {formatCacheBytes(documentBytes)}</p>}
        </div>
        {groups && <button type="button" className="cacheRescan" disabled={busy} onClick={() => run()}>{operation === "scan" ? "正在扫描…" : "重新扫描"}</button>}
      </div>
      <div className="cacheChart">
        <CacheDonut hasScanned={groups !== null} cleared={cleared} segments={chartSegments}
          formatValue={value => groups ? `${selectedBytes === null ? "≥ " : ""}${formatCacheBytes(value)}` : "—"}
          label={`可清理缓存，所选 ${formatCacheBytes(selectedBytes)}`} />
      </div>
      <div className="cacheSelectionPanel">
        {groups && <div className="cacheCategoryList" role="group" aria-label="选择缓存类型">
          {exportsGroup && categoryRow(exportsGroup)}
          {backups.length > 0 && <div className="cacheBackupGroup" style={{ "--cache-color": categories.ocrBackups.color }}>
            <span className="cacheBackupCheck">{checkbox(selection(backups), "选择全部备份")}</span>
            <details>
              <summary className="cacheCategory">
                <span className="cacheCategoryName">备份</span>
                <span className="cacheCategorySize">{sizeOf(backups)}</span>
                <span className="cacheBackupDisclosure" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg></span>
              </summary>
              <div className="cacheBackupItems" role="group" aria-label="备份类型">{backups.map(categoryRow)}</div>
            </details>
          </div>}
          {localData.length > 0 && <div className="cacheCategory cacheReadOnly">
            {checkbox({ all: false, mixed: false, disabled: true }, "本地数据")}
            <span className="cacheCategoryName">本地数据 <small>保留</small></span>
            <span className="cacheCategorySize">{sizeOf(localData)}</span>
          </div>}
          {temporary.length > 0 && <label className="cacheCategory" style={{ "--cache-color": temporaryColor }}>
            {checkbox(selection(temporary), "临时文件")}
            <span className="cacheCategoryName">临时文件</span>
            <span className="cacheCategorySize">{sizeOf(temporary)}</span>
          </label>}
          {other && categoryRow(other)}
          {recycle && <button type="button" className="cacheCategory cacheRecycleButton" aria-haspopup="dialog" disabled={busy} onClick={() => recycleRef.current?.showModal()}>
            <span className="cacheCategoryName">回收站</span>
            <span className="cacheCategorySize">{sizeOf([recycle])}</span>
            <span className="cacheBackupDisclosure" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg></span>
          </button>}
        </div>}
        <button type="button" className="cacheClearButton" disabled={busy || (!!groups && !selectedIds.length)} onClick={() => groups ? confirmRef.current?.showModal() : run()}>{busy ? operation === "scan" ? "正在扫描…" : "正在处理…" : !groups ? "开始扫描" : selectedIds.length ? `${selectedIds.length === eligible.filter(group => group.clearable).length && !chosen.some(group => !group.clearable) ? "清除缓存" : "清除所选"}${selectedBytes === null ? "" : ` ${formatCacheBytes(selectedBytes)}`}` : groups && !eligible.length ? "暂无可清理缓存" : "请选择缓存类型"}</button>
        {message && <p className="cacheStatus" role="status">{message}</p>}
      </div>
    </div>
    {recycle && <dialog ref={recycleRef} className="cacheConfirm" aria-labelledby="cache-recycle-title">
      <h3 id="cache-recycle-title">回收站</h3>
      <p>在「文件」App 打开 <strong>我的 iPad → MarginNote 4 → CardLink</strong>，手动删除其中的「回收站」文件夹。</p>
      <p>如果文件仍在「最近删除」，从那里彻底删除后才会释放空间。回到插件点击「重新扫描」更新占用。</p>
      {recycle.error && <p>{recycle.error}</p>}
      <div><button type="button" onClick={() => recycleRef.current.close()}>关闭</button></div>
    </dialog>}
    <dialog ref={confirmRef} className="cacheConfirm" aria-labelledby="cache-confirm-title">
      <h3 id="cache-confirm-title">将所选文件移入回收站？</h3>
      <p>将 {chosen.length} 类文件完整移入回收站{selectedBytes === null ? "（部分大小未知）" : `，共 ${formatCacheBytes(selectedBytes)}`}。{chosen.some(group => !group.clearable) ? "包含默认保留文件。" : "未选中的默认保留文件不会移动。"}</p>
      <p>移入后仍占空间。请到“文件”App 的 MarginNote 4 / CardLink / 回收站 手动删除该文件夹，才能释放空间。</p>
      <ul>{chosen.map(group => <li key={group.id}>{categories[group.id]?.title || group.title}{!group.clearable && "（用户文件）"}</li>)}</ul>
      <div><button type="button" onClick={() => confirmRef.current.close()}>取消</button><button type="button" className="cacheConfirmDelete" onClick={() => { confirmRef.current.close(); run(selectedIds) }}>确认清理</button></div>
    </dialog>
  </section>
}
