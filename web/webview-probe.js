const status = document.createElement('output')
status.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:20;pointer-events:none;padding:8px 12px;' +
  'border-radius:8px;background:#17283a;color:#fff;font:12px/1.5 system-ui;white-space:pre-wrap;max-width:calc(100% - 16px)'
document.body.append(status)
const raw = document.body.hasAttribute('data-probe-raw')
const browser = document.body.hasAttribute('data-probe-browser')
const onWindow = document.body.dataset.probeMount === 'window'
const scene = document.body.dataset.probeMount === 'scene'
const mountLabel = browser ? 'Safari' : scene ? '场景面板' : onWindow ? '窗口层' : '学习视图'
const mode = document.querySelector('[data-mode]')
const tray = document.querySelector('.cardlink-answer-ink-tools')
const defaults = document.querySelector('[data-native-default]')
const buttons = document.createElement('div')
buttons.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:20'
const send = command => { window.location.href = 'cardlink-answer-ink://' + command + '?webview-probe' }
const active = () => raw ? mode.getAttribute('aria-pressed') === 'true' : tray?.hasAttribute('data-editing')
function addSwitch(label, command) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.style.cssText = 'margin-right:4px;border:0;border-radius:8px;background:#17283a;color:#fff;' +
    'padding:8px 12px;font:13px system-ui'
  button.onclick = () => {
    if (active()) return
    for (const control of buttons.children) control.disabled = true
    send(command)
  }
  buttons.append(button)
}
if (!raw && !scene) addSwitch(onWindow ? '切到学习视图' : '切到窗口层', 'switch-host')
if (onWindow && !browser) addSwitch(raw ? '返回书写页' : '打开原始事件页', 'switch-page')
document.body.append(buttons)
if (tray) new MutationObserver(() => { buttons.hidden = active() }).observe(tray, { attributeFilter: ['data-editing'] })
window.cardLinkProbeSwitchFailed = () => {
  for (const button of buttons.children) button.disabled = false
  native = '无法切换测试模式'
  show()
}
const counters = { pointer: 0, touch: 0, cancel: 0, written: 0, rendered: 0, dropped: 0,
  pointerUp: 0, touchEnd: 0, touchCancel: 0, moveFirst: 0 }
let native = raw ? '点「开始记录」' : '点「批注」开始'
let startMode, nativeResult
const results = new Map()
function remember() {
  if (!startMode) return
  results.set(startMode, startMode + ' · 网页落笔 ' + counters.pointer + '/' + counters.touch +
    (nativeResult && (nativeResult.pencil || nativeResult.finger) ? ' · 原生笔 ' + nativeResult.pencil :
      browser ? '' : ' · 原生未验证'))
}

function show() {
  const down = mountLabel + (raw ? ' · 原始事件' : '') + ' · 落笔 Pointer ' + counters.pointer + ' / Touch ' + counters.touch
  const detail = raw
    ? '\n抬笔 Pointer ' + counters.pointerUp + ' / Touch ' + counters.touchEnd +
      ' · 取消 ' + counters.cancel + ' / ' + counters.touchCancel
    : ' · 取消 ' + counters.cancel + '\n已提交 ' + counters.written + ' · 已绘制 ' + counters.rendered +
      (scene ? ' · 无落笔先收到接触移动 ' + counters.moveFirst : '') +
      (counters.dropped ? ' · 日志丢弃 ' + counters.dropped : '')
  const text = down + detail + '\n' + native + (nativeResult ?
    '\n原生触点：Pencil ' + nativeResult.pencil + ' / 手指 ' + nativeResult.finger + ' / 未分类 ' + nativeResult.other : '') +
    (results.size > 1 ? '\n' + [...results.values()].join('\n') : '')
  if (status.textContent !== text) status.textContent = text
}
window.cardLinkProbeTouchDelivery = values => {
  native = values === null ? '保留 WebView 原生触摸设置' :
    '宿主设置已关闭 ' + values.filter(value => value === 1).length + '/4（延迟 / 取消 / 捏合 / 滚动）'
  show()
}
window.cardLinkProbeNativeResult = result => {
  nativeResult = result
  if (!result) native += '\n原生观察器不可用'
  else if (!result.pencil && !result.finger && !result.other) native += '\n原生观察器未收到回调'
  remember()
  show()
}

function collect() {
  // Drain the original editor's event stream inside the page. This excludes
  // native polling and persistence from the diagnostic window.
  let snapshot
  while ((snapshot = window.cardLinkAnswerInkSnapshot(false, Infinity, Infinity))) {
    const trace = JSON.parse(snapshot).diagnostics
    if (!trace) break
    counters.dropped += trace.dropped
    for (const [, , kind, source, tiles] of trace.events) {
      if (kind === 'raw.pointerdown' && source === 'pen') counters.pointer++
      if (kind === 'raw.touchstart' && source === 'stylus') counters.touch++
      if ((kind === 'raw.pointercancel' && source === 'pen') ||
          (kind === 'raw.touchcancel' && source === 'stylus')) counters.cancel++
      if (kind === 'raw.pen-contact-without-down') counters.moveFirst++
      if (kind === 'engine.commit') counters.written++
      if (kind === 'render.commit' && tiles > 0) counters.rendered++
    }
  }
  show()
}
if (scene) {
  window.cardLinkAnswerInkConfig.notify = command => {
    const request = /^(prepare|publish)\/(\d+)$/.exec(command)
    if (request) {
      const id = Number(request[2])
      if (request[1] === 'prepare') window.cardLinkAnswerInkPrepared(id, '')
      else window.cardLinkAnswerInkPublishResult('', 'probe', '测试图片已生成', id)
      return
    }
    if (command === 'start') {
      window.cardLinkAnswerInkSnapshot(false, Infinity, Infinity)
      for (const key of Object.keys(counters)) counters[key] = 0
      native = '画 20 个圈，再结束批注'
    } else native = '本轮结束'
    collect()
  }
}
show()
if (raw) {
  mode.onclick = () => {
    const starting = !active()
    if (starting) {
      for (const key of Object.keys(counters)) counters[key] = 0
      startMode = browser ? 'Safari' : defaults.checked ? '原生设置' : '关闭触摸设置'
      native = browser ? 'Safari 浏览器对照' : '正在应用宿主设置'
      nativeResult = undefined
    }
    mode.setAttribute('aria-pressed', String(starting))
    mode.textContent = starting ? '结束记录' : '开始记录'
    buttons.hidden = starting
    document.body.toggleAttribute('data-recording', starting)
    if (defaults) defaults.disabled = starting
    if (!browser) send(starting ? (defaults.checked ? 'start-raw-default' : 'start-raw') : 'end-raw')
    else if (!starting) remember()
    show()
  }
  const listen = (event, counter, count) => window.addEventListener(event, input => {
    if (!active()) return
    const added = count(input)
    if (!added) return
    counters[counter] += added
    requestAnimationFrame(show)
  }, { capture: true, passive: true })
  const pen = event => Number(event.pointerType === 'pen')
  const stylus = event => Array.from(event.changedTouches).filter(touch => touch.touchType === 'stylus').length
  listen('pointerdown', 'pointer', pen)
  listen('pointerup', 'pointerUp', pen)
  listen('pointercancel', 'cancel', pen)
  listen('touchstart', 'touch', stylus)
  listen('touchend', 'touchEnd', stylus)
  listen('touchcancel', 'touchCancel', stylus)
} else setInterval(collect, 250)
