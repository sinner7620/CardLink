import React, { useEffect, useState } from "react"
import { DEFAULT_SCENE_PRESETS } from "./lib/sceneWindow"
import { useSizeGlassFooter } from "./lib/useSizeGlassFooter"
export function SceneSizeGlass({ size, presets, onResize, onSave, onRemove, onClose }) {
  const [draft, setDraft] = useState(size), [notice, setNotice] = useState("")
  const glass = useSizeGlassFooter(onResize, onClose, `${presets.length}:${notice}`)
  useEffect(() => setDraft(size), [size.width, size.height])
  function commit(key) {
    const value = Number(draft[key])
    if (draft[key] === "" || !Number.isFinite(value)) { setDraft(size); return }
    onResize(key === "width" ? value : size.width, key === "height" ? value : size.height)
  }
  const allPresets = [...DEFAULT_SCENE_PRESETS, ...presets]
  return <div ref={glass.surface} className="sceneSizeFormSurface">
    {!glass.failure && <canvas ref={glass.canvasRef} className="sceneSizeBackdrop" aria-label="尺寸弹窗网格与蓝色玻璃按钮" />}
    <div ref={glass.form} className="sceneSizeForm">
      <strong>窗口大小</strong>
      {[ ["width", "宽度"], ["height", "高度"] ].map(([key, label]) => <div className="sceneSizeRow" key={key}>
        <span>{label}</span>
        <button type="button" aria-label={`减小${label}`} onClick={() => onResize(key === "width" ? size.width - 20 : size.width, key === "height" ? size.height - 20 : size.height)}>−</button>
        <input aria-label={`窗口${label}`} type="number" min="360" max={key === "height" ? 1000 : undefined} value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} onBlur={() => commit(key)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur() }} />
        <button type="button" aria-label={`增大${label}`} onClick={() => onResize(key === "width" ? size.width + 20 : size.width, key === "height" ? size.height + 20 : size.height)}>+</button>
      </div>)}
      <div className="scenePresetHeading"><span>预设</span><button type="button" aria-label="保存当前尺寸为预设" onClick={() => {
        try { onSave(); setNotice("已保存当前尺寸") } catch { setNotice("预设保存失败，请重试") }
      }}>保存当前</button></div>
      <div className="scenePresetChips">{allPresets.map((preset, index) => <span className="scenePresetChip" key={`${index}:${preset.width}x${preset.height}`}>
        <button type="button" title={`${preset.width} × ${preset.height}`} onClick={() => onResize(preset.width, preset.height)}>预设{index + 1}</button>
        {index >= DEFAULT_SCENE_PRESETS.length && <button type="button" className="scenePresetRemove" aria-label={`删除预设${index + 1}`} title={`删除预设${index + 1}`} onClick={() => {
          try { onRemove(preset); setNotice("已删除预设") } catch { setNotice("预设删除失败，请重试") }
        }}>×</button>}
      </span>)}</div>
      <div className="sceneSizeFooter">
        <button ref={glass.reset} type="button" className="sceneGlassFooterAction" aria-label="恢复默认" disabled={Boolean(glass.failure)} onPointerDown={glass.pointerDown} onClick={event => { if (event.detail === 0) onResize(640, 620) }} />
        <button ref={glass.done} type="button" className="sceneGlassFooterAction" aria-label="完成" disabled={Boolean(glass.failure)} onPointerDown={glass.pointerDown} onClick={event => { if (event.detail === 0) onClose() }} />
      </div>
      {glass.failure && <p role="alert" className="sceneSizeNotice">玻璃按钮加载失败：{glass.failure}。按 Esc 关闭。</p>}
      {notice && <p className="sceneSizeNotice" role="status">{notice}</p>}
    </div>
  </div>
}
