import { createInkSurface, paintAnswer, isDrawesomeHighlight } from './ink842/ink-surface.js'
import { PAGE_WIDTH } from './ink842/ink-geometry.js'
import { createStrokeIndex } from './ink842/ink-eraser.js'
import { createInlineInkAnchors, projectInlineInk } from './ink842/inline-ink-anchors.js'
import { createInlineInkTiles } from './ink842/inline-ink-tiles.js'
import { normalizeInkSettings } from './ink842/ink-settings.js'
import { createInkDiagnostics } from './ink842/ink-diagnostics.js'
import { mountAnswerInkToolbar } from './answer-ink-toolbar.jsx'
import { ANSWER_INK_MAX_WIDTH } from '../src/window-controls'
import baseCss from './plugin-ink.css'
import editorCss from './answer-ink.css'
import html2canvas from 'html2canvas'

const config = window.cardLinkAnswerInkConfig
const card = document.querySelector('article.card')
const checkpointDelay = 1200
const layoutWaitMs = 250
if (config && card) installEditor()

function installEditor() {
  const style = document.createElement('style')
  style.textContent = baseCss.slice(baseCss.indexOf('.ink-tools {'), baseCss.indexOf('\nfooter {')) + '\n' + editorCss
  document.head.append(style)

  const saved = card.parentElement.querySelectorAll(':scope > [data-answer-ink-saved]')
  const reading = document.createElement('div')
  const workspace = document.createElement('section')
  workspace.className = 'answer-ink-workspace'
  workspace.hidden = true
  workspace.setAttribute('aria-label', '答案批注答题纸')
  card.before(reading, workspace)
  reading.append(card, ...saved)
  const box = document.createElement('section')
  box.className = 'cardlink-answer-ink-tools'
  box.innerHTML = '<div data-answer-ink-tray></div><div class="answer-ink-popups"></div><span role="status"></span>'
  reading.before(box)
  card.classList.add('answer-ink-card')

  const status = box.querySelector('[role="status"]')
  const viewport = document.querySelector('meta[name="viewport"]')
  const readingViewport = viewport?.content
  const answer = config.answer || { height: 1, strokes: [], styles: [] }
  const anchors = createInlineInkAnchors(card)
  const readingTiles = createInlineInkTiles(card)
  const trace = config.debug ? createInkDiagnostics() : null
  let revision = 0, settingsRevision = 0, settings = normalizeInkSettings(config.settings)
  let surface, image, readingFrame, readingIndex, hasHighlights
  let checkpointTimer
  let attempt, attemptSequence = 0
  let preparing = false, publishing = false, readingScroll = 0, publishedRevision = -1
  let frame = config.toolbarFrame || [6, 36, 6]
  let reportedHitWidth
  let history = { undo: false, redo: false }
  let preview = Array.from(saved).find(item => item.dataset.answerInkSaved === config.group)
  let previewImage, previewPending = false
  const send = command => {
    if (typeof config.notify === 'function') config.notify(command)
    else window.location.href = 'cardlink-answer-ink://' + command + '?' + config.token
  }
  function deferCheckpoint() {
    clearTimeout(checkpointTimer)
    checkpointTimer = setTimeout(() => {
      if (!surface) return
      if (publishing || surface.hasActiveContact()) deferCheckpoint()
      else send('checkpoint')
    }, checkpointDelay)
  }
  const renderToolbar = mountAnswerInkToolbar(box.querySelector('[data-answer-ink-tray]'), {
    // A portal on body delegates React's touch and pointer events across the canvas.
    portalContainer: box.querySelector('.answer-ink-popups'),
    open: () => { if (!preparing && !publishing && !surface) void beginWriting() },
    close: () => { if (!preparing && !publishing && surface) void saveAndClose() },
    select: tool => surface?.selectTool(tool),
    change: patch => surface?.changeTools(patch),
    undo: () => surface?.undo(), redo: () => surface?.redo(),
    reportWidth: width => {
      const pixels = Math.min(ANSWER_INK_MAX_WIDTH, Math.ceil(width - .01))
      if (pixels === reportedHitWidth) return
      reportedHitWidth = pixels
      send('hit/' + pixels)
    }
  })
  function refreshToolbar() {
    box.toggleAttribute('data-editing', Boolean(surface))
    syncVisualViewport()
    renderToolbar({ settings, active: Boolean(surface), busy: preparing || publishing, frame, history })
  }
  function syncVisualViewport() {
    const visual = surface ? undefined : window.visualViewport
    const scale = visual?.scale || 1
    box.style.top = (visual?.offsetTop || 0) + 'px'
    box.style.right = (visual ? window.innerWidth - visual.offsetLeft - visual.width + frame[2] / scale : frame[2]) + 'px'
    box.style.transform = scale === 1 ? '' : `scale(${1 / scale})`
  }
  function showPreview() {
    if (!preview?.open) return
    if (previewImage) {
      const img = preview.querySelector('img')
      img.src = previewImage
      img.hidden = false
    } else if (!previewPending) {
      previewPending = true
      send('preview')
    }
  }
  preview?.addEventListener('toggle', showPreview)
  window.cardLinkAnswerInkPreview = (value, notice) => {
    previewPending = false
    previewImage = value
    status.textContent = notice
    if (value) showPreview()
  }
  status.textContent = config.error || ''
  window.cardLinkAnswerInkLayout = (top, height, right, left) => {
    frame = [top, height, right, left]
    box.style.setProperty('--answer-ink-top', top + 'px')
    box.style.setProperty('--answer-ink-height', height + 'px')
    box.style.setProperty('--answer-ink-right', right + 'px')
    refreshToolbar()
  }
  window.cardLinkAnswerInkLayout(...frame)

  function projectDraft(boxes) {
    answer.strokes.forEach((points, i) => {
      const projected = projectInlineInk(points, answer.styles[i], key => boxes.get(key))
      if (!projected) return
      answer.strokes[i] = projected.points
      answer.styles[i] = projected.style
    })
  }
  function drawReadingInk() {
    readingFrame = undefined
    if (surface || !answer.strokes.length || !card.clientWidth) return
    if (!readingIndex) {
      projectDraft(anchors.snapshot(PAGE_WIDTH))
      readingIndex = createStrokeIndex(answer.strokes, answer.styles)
      hasHighlights = answer.styles.some(isDrawesomeHighlight)
      readingTiles.clear()
    }
    for (const tile of readingTiles.update(card.clientWidth, card.clientHeight, PAGE_WIDTH)) {
      if (!tile.dirty) continue
      const strokes = readingIndex.query(tile.bounds)
      tile.dirty = false
      if (!strokes.size) { readingTiles.drop(tile, 'dry'); readingTiles.drop(tile, 'highlight'); continue }
      const ctx = readingTiles.context(tile, 'dry', true)
      if (ctx) paintAnswer(ctx, answer, strokes, hasHighlights ? readingTiles.context(tile, 'highlight', true) || ctx : ctx)
    }
  }
  function refreshReadingInk() {
    if (!surface && readingFrame === undefined) readingFrame = requestAnimationFrame(drawReadingInk)
  }
  function invalidateReadingInk() {
    readingIndex = undefined
    refreshReadingInk()
  }
  let readingLayout
  function refreshReadingLayout() {
    if (surface || preparing) return
    const size = [card.clientWidth, card.clientHeight].join(':')
    if (size !== readingLayout) {
      readingLayout = size
      invalidateReadingInk()
    }
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refreshReadingLayout) : null
  observer?.observe(card)
  window.addEventListener('resize', () => { syncVisualViewport(); refreshReadingLayout() })
  window.addEventListener('scroll', refreshReadingInk, { passive: true })
  function onVisualViewportChange() { syncVisualViewport(); refreshReadingInk() }
  window.visualViewport?.addEventListener('resize', onVisualViewportChange)
  window.visualViewport?.addEventListener('scroll', onVisualViewportChange, { passive: true })
  card.addEventListener('load', invalidateReadingInk, true)
  card.addEventListener('toggle', invalidateReadingInk, true)

  async function waitForAnswerLayout() {
    const pending = Array.from(card.querySelectorAll('img')).filter(img => !img.complete && !img.naturalWidth && img.getClientRects().length)
    const fonts = document.fonts?.status === 'loading' ? document.fonts.ready : undefined
    if (!pending.length && !fonts) return
    let timer
    try {
      const ready = Promise.all([
        Promise.resolve(fonts).catch(() => {}),
        ...pending.map(img => Promise.resolve().then(() => img.decode?.()).catch(() => {}))
      ])
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => {
          trace?.add('web.edit.layout-timeout', 1)
          resolve()
        }, layoutWaitMs)
      })
      await Promise.race([ready, deadline])
    } finally {
      clearTimeout(timer)
    }
  }

  async function beginWriting() {
    preparing = true
    refreshToolbar()
    status.textContent = '正在打开批注答题纸…'
    try {
      await waitForAnswerLayout()
      const width = card.offsetWidth, height = card.offsetHeight
      if (!width || !height) throw new Error('无法读取答案大小')
      const boxes = anchors.snapshot(PAGE_WIDTH)
      projectDraft(boxes)
      const targets = Array.from(boxes).reverse()
      answer.height = Math.max(answer.height, Math.ceil(height * PAGE_WIDTH / width))
      readingScroll = window.visualViewport?.pageTop ?? window.scrollY
      if (viewport) viewport.content = 'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no'
      readingTiles.clear()
      const paper = document.createElement('div')
      paper.className = 'answer-ink-paper'
      const content = document.createElement('div')
      content.className = 'answer-ink-paper-content'
      content.style.width = width + 'px'
      content.style.transform = `scale(${PAGE_WIDTH / width})`
      paper.append(content)
      const placeholder = document.createElement('canvas')
      placeholder.setAttribute('aria-label', '答案手写批注区')
      workspace.append(placeholder)
      content.append(card)
      reading.hidden = true
      workspace.hidden = false
      surface = createInkSurface(workspace, answer, {
        paper, fullWindow: true, extendToViewport: false,
        toolbar: false,
        answerPaper: {
          anchorAt([x, y]) {
            const match = targets.find(([, [left, top, w, h]]) => x >= left && x <= left + w && y >= top && y <= top + h)
            return match ? { key: match[0], rect: match[1] } : undefined
          }
        },
        toolsSettings: settings, isLocked: () => publishing,
        onDiagnostic: trace?.add,
        onChange() { revision++; deferCheckpoint() },
        onToolsChange(value) { settings = value; settingsRevision++; deferCheckpoint(); refreshToolbar() },
        onHistoryChange(undo, redo) {
          if (undo === history.undo && redo === history.redo) return
          history = { undo, redo }
          refreshToolbar()
        }
      })
      if (readingScroll > 0) {
        surface.setInlineView({ x: 0, y: -readingScroll * workspace.clientWidth / width, zoom: 1 })
      }
      status.textContent = ''
      trace?.add('web.edit', 1)
      send('start')
    } catch (error) {
      restoreReader()
      status.textContent = error?.message || '无法打开批注答题纸'
    } finally {
      preparing = false
      refreshToolbar()
    }
  }

  function restoreReader() {
    if (workspace.hidden) return
    surface?.dispose()
    clearTimeout(checkpointTimer)
    surface = undefined
    reading.prepend(card)
    history = { undo: false, redo: false }
    workspace.replaceChildren()
    workspace.hidden = true
    reading.hidden = false
    if (viewport && readingViewport) viewport.content = readingViewport
    window.scrollTo(0, readingScroll)
    refreshToolbar()
    invalidateReadingInk()
  }
  function endWriting() {
    restoreReader()
    trace?.add('web.edit', 0)
    send('end')
  }
  window.addEventListener('keydown', event => {
    if (!surface || publishing || event.target.closest?.('input, select, textarea, [contenteditable]')) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) surface.redo()
      else surface.undo()
    }
  })

  window.cardLinkAnswerInkSnapshot = (flush, after, afterSettings, preparingSave, diagnosticsOnly) => {
    if (flush) surface?.flush()
    const diagnostics = trace?.drain(flush)
    const canSave = !diagnosticsOnly && (flush || !surface?.hasActiveContact())
    const answerChanged = canSave && revision > after, settingsChanged = canSave && settingsRevision > afterSettings
    if (!diagnostics && !preparingSave && !answerChanged && !settingsChanged) return ''
    return JSON.stringify({ token: config.token, revision, settingsRevision,
      ...(answerChanged ? { answer } : {}), ...(settingsChanged ? { settings } : {}), ...(diagnostics ? { diagnostics } : {}) })
  }
  window.cardLinkAnswerInkResult = (_saved, error) => {
    if (error) status.textContent = error
  }
  window.cardLinkAnswerInkHover = (x, y, distance) => surface?.setPencilHoverDistance(x, y, distance)
  function saveAndClose() {
    surface.flush()
    if (revision === publishedRevision || (!revision && !answer.strokes.length)) { endWriting(); return }
    publishing = true
    refreshToolbar()
    status.textContent = '正在保存可编辑笔迹…'
    const id = ++attemptSequence
    attempt = { id, revision, phase: 'saving', timer: setTimeout(() => {
      window.cardLinkAnswerInkPublishResult('保存响应超时，可重试', '', '', id)
    }, 30000) }
    send('prepare/' + id)
  }

  window.cardLinkAnswerInkPrepared = async (id, error, alreadyPublished) => {
    if (attempt?.id !== id || attempt.phase !== 'saving') return
    if (error) { window.cardLinkAnswerInkPublishResult(error, '', '', id); return }
    if (alreadyPublished || (!answer.strokes.length && !preview)) {
      window.cardLinkAnswerInkPublishResult('', '', '草稿已保存', id)
      return
    }
    attempt.phase = 'rendering'
    status.textContent = '正在生成批注图片…'
    let bitmap, canvas
    try {
      const width = card.offsetWidth, height = card.offsetHeight
      let scale = Math.min(2 * width / PAGE_WIDTH, 2000 / PAGE_WIDTH, 6000 / answer.height,
        Math.sqrt(3000000 / (PAGE_WIDTH * answer.height)))
      if (scale * PAGE_WIDTH / width < .1) throw new Error('答案过长，无法导出批注图片')
      bitmap = await html2canvas(card, {
        scale: scale * PAGE_WIDTH / width, width, height, backgroundColor: '#fff', logging: false,
        scrollX: 0, scrollY: 0,
        onclone(doc) {
          // Capture the original layout regardless of the current canvas pan or zoom.
          for (const element of doc.querySelectorAll('.answer-ink-paper, .answer-ink-paper-content')) element.style.transform = 'none'
          for (const element of doc.querySelectorAll('.answer-ink-workspace, .answer-ink-workspace > .ink-viewport')) element.style.overflow = 'visible'
        }
      })
      if (attempt?.id !== id) return
      if (!bitmap.width || !bitmap.height) throw new Error('答案背景生成失败')
      canvas = document.createElement('canvas')
      let png
      const inkPixels = answer.strokes.length > 0
      for (let pass = 0; pass < 3; pass++, scale *= .75) {
        canvas.width = Math.max(1, Math.floor(PAGE_WIDTH * scale))
        canvas.height = Math.max(1, Math.min(6000, Math.ceil(answer.height * scale)))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('无法生成批注图片')
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.scale(canvas.width / PAGE_WIDTH, canvas.width / PAGE_WIDTH)
        ctx.drawImage(bitmap, 0, 0, PAGE_WIDTH, height * PAGE_WIDTH / width)
        const background = inkPixels ? ctx.getImageData(0, 0, canvas.width, canvas.height).data : null
        surface.paintInk(ctx)
        if (background) {
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
          let i = 0
          while (i < data.length && data[i] === background[i] && data[i + 1] === background[i + 1] && data[i + 2] === background[i + 2]) i += 4
          if (i >= data.length) throw new Error('导出的图片没有可见笔迹')
        }
        png = canvas.toDataURL('image/png')
        if (png.length <= 4000000) break
      }
      if (!png?.startsWith('data:image/png;base64,') || png.length > 4000000) throw new Error('无法导出批注图片或图片过大')
      const decoded = new Image()
      decoded.src = png
      await decoded.decode()
      if (decoded.naturalWidth !== canvas.width || decoded.naturalHeight !== canvas.height) throw new Error('批注图片尺寸校验失败')
      if (attempt?.id !== id) return
      image = { image: png, width: canvas.width, height: canvas.height, revision: attempt.revision, inkPixels }
      attempt.phase = 'publishing'
      status.textContent = '正在保存批注图片…'
      send('publish/' + id)
    } catch (error) { window.cardLinkAnswerInkPublishResult(error.message, '', '', id) }
    finally {
      if (bitmap) bitmap.width = bitmap.height = 1
      if (canvas) canvas.width = canvas.height = 1
    }
  }
  window.cardLinkAnswerInkImage = id => attempt?.id === id ? JSON.stringify(image) : undefined
  window.cardLinkAnswerInkPublishResult = (error, marker, notice, id) => {
    if (attempt?.id !== id) return
    clearTimeout(attempt.timer)
    const savedRevision = attempt.revision
    attempt = undefined
    publishing = false
    refreshToolbar()
    const savedImage = image?.image
    image = undefined
    status.textContent = error || notice
    if (error) return
    publishedRevision = savedRevision
    if (!savedImage) { endWriting(); return }
    if (!preview) {
      preview = document.createElement('details')
      preview.dataset.answerInkSaved = marker
      preview.className = 'answer-ink-saved'
      preview.innerHTML = '<summary>答案批注</summary><img hidden alt="答案批注">'
      preview.addEventListener('toggle', showPreview)
      reading.append(preview)
    }
    preview.open = false
    const previewElement = preview.querySelector('img')
    previewElement.hidden = true
    previewElement.removeAttribute('src')
    previewImage = savedImage
    endWriting()
  }
  refreshReadingInk()
}
