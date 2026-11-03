import { createInkSurface } from './ink842/ink-surface.js'
import { restoreInkAnswer, serializeInkAnswer } from './ink842/record.js'
import { PAGE_WIDTH } from './ink842/ink-geometry.js'
import inkCss from './plugin-ink.css'
import { installWebUiColors } from '../src/ui-tokens'
import { installInkWindowControls } from './plugin-ink-window-controls.js'
import html2canvas from 'html2canvas'

const style = document.createElement('style')
style.textContent = inkCss
document.head.append(style)
installWebUiColors(document.documentElement.style)
document.body.innerHTML = `<header><button id="cancel" class="icon-button" aria-label="关闭批注" title="关闭批注">×</button><div id="window-drag" title="拖动移动窗口"><span class="eyebrow">插件内批注</span><strong id="title">复习作答</strong></div><button id="window-size" aria-label="窗口大小" aria-expanded="false" aria-controls="size-panel">窗口</button><button id="save" class="primary" disabled>保存并完成</button></header><main id="workspace" class="answer-box"><div class="ink-tools"></div><canvas aria-label="原题手写批注区"></canvas></main><footer><span id="message" role="status">正在准备作答纸…</span></footer><button id="resize-grip" aria-label="拖动调节窗口大小" title="拖动调节大小；方向键微调"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></button><section id="size-panel" role="dialog" aria-label="窗口大小" hidden><div class="size-heading"><strong>窗口大小</strong><button id="size-close" class="icon-button" aria-label="关闭窗口设置">×</button></div><div class="size-presets"><button data-window-preset="compact">紧凑</button><button data-window-preset="standard">标准</button><button data-window-preset="fill">铺满</button></div><form id="size-form"><label>宽度<input id="window-width" type="number" min="360" step="1" required></label><span>×</span><label>高度<input id="window-height" type="number" min="340" step="1" required></label><button type="submit" class="primary">应用</button></form><p>拖动标题移动 · 右下角调整大小</p></section><div id="loading" role="status">正在准备作答纸…</div>`
const $ = id => document.getElementById(id)
const send = name => { window.location.href = 'cardlink-ink://' + name }
const message = text => { $('message').textContent = text }
const loadImage = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片加载失败')); image.src = src })
let surface, answer, background, backgroundHeight, busy = false, dirty = false
const windowControls = installInkWindowControls({ send: (frame) => send('layout?' + encodeURIComponent(JSON.stringify(frame))), isLocked: () => busy, flush: () => surface?.flush() })

async function backgroundFromCard(html) {
  const frame = document.createElement('iframe'); frame.id = 'source'; document.body.append(frame)
  try {
    await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = () => reject(new Error('原题加载失败')); frame.srcdoc = html })
    const doc = frame.contentDocument
    await doc.fonts?.ready
    await Promise.all([...doc.images].map(img => img.complete ? Promise.resolve() : new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('原题图片未加载完成')) })))
    const card = doc.querySelector('.card')
    card.style.minHeight = '0'; card.style.padding = '24px'; card.querySelectorAll('details').forEach(d => { d.open = true })
    const rect = card.getBoundingClientRect(), w = Math.ceil(rect.width), h = Math.ceil(rect.height) + 600
    if (w * h > 16000000 || h > 16000) throw new Error('原题过长，无法生成作答纸')
    const capture = await html2canvas(card, { scale: 1, backgroundColor: '#fff', logging: false })
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#faf9e9'; ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#e4e5cf'; ctx.lineWidth = .5
    for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
    ctx.drawImage(capture, 0, 0)
    return { background: canvas.toDataURL('image/png'), width: w, height: h }
  } finally { frame.remove() }
}


window.cardlinkInkOpen = async config => {
  try {
    $('title').textContent = config.title
    windowControls.update(config.window)
    const sheet = config.saved || await backgroundFromCard(config.html)
    background = sheet.background
    const image = await loadImage(background)
    backgroundHeight = config.saved?.backgroundHeight || image.naturalHeight * PAGE_WIDTH / image.naturalWidth
    answer = config.saved ? restoreInkAnswer(config.saved) : { height: Math.ceil(sheet.height * PAGE_WIDTH / sheet.width), strokes: [], styles: [] }
    if (answer.height > 16000) throw new Error('原题过长，无法生成作答纸')
    surface = createInkSurface($('workspace'), answer, {
      background: image, backgroundHeight, fullWindow: true, extendToViewport: false,
      isLocked: () => busy,
      onChange: () => { dirty = true; message('尚未保存 · 完成后保存到原题的折叠图片评论') }
    })
    $('workspace').querySelector('[data-ink="full"]')?.remove()
    dirty = false; $('loading').hidden = true; $('save').disabled = false
    message('Pencil 写字 · 单指移动 · 双指缩放 · 再点当前工具可打开设置')
  } catch (error) { $('loading').textContent = error.message; message(error.message) }
}
window.cardlinkInkResult = error => { busy = false; $('save').disabled = false; $('cancel').disabled = false; message(error) }
window.cardlinkInkPreparePayload = () => {
  if (busy || !surface) throw new Error('批注尚未准备好或正在保存，请稍候')
  surface.flush()
  windowControls.close()
  const result = { width: PAGE_WIDTH, height: answer.height, background, backgroundHeight, image: surface.exportImage(), strokes: serializeInkAnswer(answer) }
  busy = true; $('save').disabled = true; $('cancel').disabled = true
  message('正在保存图片与可编辑笔画…')
  window.cardlinkInkPayload = result
  return result
}
$('save').onclick = () => {
  try { window.cardlinkInkPreparePayload(); send('save') }
  catch (error) { window.cardlinkInkResult(error.message) }
}
$('cancel').onclick = () => {
  if (busy) return
  surface?.flush()
  if (!dirty || window.confirm('放弃这次尚未保存的修改？')) { surface?.dispose(); send('cancel') }
}
window.addEventListener('pagehide', () => surface?.flush())
send('ready')
