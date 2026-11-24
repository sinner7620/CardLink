import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toolbar } from './vendor/drawesome/components/Toolbar'
import { ToolIcon } from './vendor/drawesome/components/ToolIcon'
import { BarSlider } from './vendor/drawesome/components/BarSlider'
import { PEN_BY_ID } from './vendor/drawesome/engine/pens'
import { FEEL_CONTROLS, INK_COLORS } from './ink842/ink-settings.js'
import { ANSWER_INK_MAX_WIDTH } from '../src/window-controls'
import './vendor/drawesome/components/tokens.css'

const pens = [{ ...PEN_BY_ID.fountain, name: '钢笔' }, { ...PEN_BY_ID.highlighter, name: '荧光笔' }]
const swatches = INK_COLORS.map(([color]) => color)
const inkTools = { fountain: 'pen', pen: 'pen', highlighter: 'marker', eraser: 'eraser' }
const controls = { opacity: false, clear: false }
const labels = { expand: '展开批注', collapse: '保存并收起批注', eraser: '橡皮擦' }

function ToolOptions({ settings, change }) {
  const { tool, color } = settings
  if (tool === 'eraser') return <>
    <label>擦除方式 <select value={settings.eraserMode} onChange={event => change({ eraserMode: event.target.value })}>
      <option value="partial">局部擦除</option><option value="stroke">整笔擦除</option>
    </select></label>
    <label><input type="checkbox" checked={settings.eraserAutoReturn} onChange={event => change({ eraserAutoReturn: event.target.checked })} />擦完回到上一次用笔</label>
  </>
  if (tool === 'marker') return null
  return <>
    <label><input type="checkbox" checked={settings.pressure} onChange={event => change({ pressure: event.target.checked })} />硬件压感</label>
    <label><input type="checkbox" checked={settings.scribble} onChange={event => change({ scribble: event.target.checked })} />涂抹擦除</label>
    <details>
      <summary>手感参数</summary>
      {FEEL_CONTROLS.map(([key, label, min, max]) => (
        <BarSlider key={key} label={label} value={settings[key]} min={min} max={max} color={color}
          display={String(settings[key])} onChange={value => change({ [key]: Math.round(value * 100) / 100 })} />
      ))}
    </details>
  </>
}

function AnswerInkToolbar({ settings, active, busy, frame, history, select, change, open, close, undo, redo, reportWidth, portalContainer }) {
  const [extent, setExtent] = useState(0)
  const tray = useRef(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const measure = useCallback(width => setExtent(width), [])
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const [top, height, right, left = 6] = frame
  const available = Math.max(height, Math.min(ANSWER_INK_MAX_WIDTH, viewport - right - left))
  // Drawesome's 84px tray scales itself to a disc when collapsed.
  const scaleY = height / (active ? 84 : 84 * .667)
  const scaleX = active ? Math.min(scaleY, available / (extent || ANSWER_INK_MAX_WIDTH)) : scaleY
  const targetWidth = active ? (extent || ANSWER_INK_MAX_WIDTH) * scaleX : height
  useEffect(() => {
    const measuredWidth = () => tray.current?.firstElementChild?.getBoundingClientRect().width || targetWidth
    // Keep the moving tray clickable while it folds, then return the uncovered area.
    reportWidth(Math.max(targetWidth, measuredWidth()))
    const settled = setTimeout(() => reportWidth(measuredWidth()), 580)
    return () => clearTimeout(settled)
  }, [targetWidth, active, scaleX, reportWidth])
  const tool = settings.tool === 'marker' ? 'highlighter' : settings.tool === 'eraser' ? 'eraser' : 'fountain'
  const marker = tool === 'highlighter'
  const eraser = tool === 'eraser'
  const inkFor = id => id === 'highlighter' ? settings.markerColor : settings.color
  const color = inkFor(tool)
  const sizeKey = marker ? 'markerSize' : 'size'
  const sizeLabel = eraser ? '橡皮大小' : '笔宽'
  function changeTool(patch) {
    if (patch.color) change({ [marker ? 'markerColor' : 'color']: patch.color })
    if (patch.size !== undefined) change({ [sizeKey]: Math.round(patch.size * 10) / 10 })
    if (patch.eraserSize !== undefined) change({ eraserSize: Math.round(patch.eraserSize) })
  }

  return <div ref={tray} className="sd answer-ink-toolbar-tray" data-theme="light" aria-busy={busy}
    style={{ transform: `scale(${scaleX}, ${scaleY})`, top: top + (height - 84 * scaleY) / 2,
      '--horizontal-bar-radius': `${42 * scaleY / scaleX}px / 42px` }}>
    <Toolbar
      tool={{ active: tool, color, size: settings[sizeKey], opacity: 1, eraserSize: settings.eraserSize }}
      inkFor={inkFor} pens={pens} swatches={swatches} look="classic" theme="light"
      settings="tool" controls={controls} shortcuts={false}
      portalContainer={portalContainer}
      collapsed={!active} onExpand={open} onCollapse={close} onMeasure={measure}
      icon={<ToolIcon id={tool} color={color} look="classic" />}
      labels={{ ...labels, size: sizeLabel, menu: eraser ? '橡皮擦设置' : marker ? '荧光笔设置' : '钢笔设置' }}
      toolMenu={{ below: true, minSize: eraser ? 4 : marker ? 8 : .5, maxSize: eraser ? 40 : marker ? 32 : 12,
        colorInMenu: true, extra: <ToolOptions settings={settings} change={change} /> }}
      onSelect={id => select(inkTools[id])} onChange={changeTool}
      canUndo={!busy && history.undo} canRedo={!busy && history.redo} onUndo={undo} onRedo={redo}
    />
  </div>
}

export function mountAnswerInkToolbar(element, options) {
  const root = createRoot(element)
  return function render(state) {
    root.render(<AnswerInkToolbar {...options} {...state} />)
  }
}
