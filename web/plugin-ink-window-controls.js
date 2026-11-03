/** Geometry changes travel to the native UIView; paper zoom remains independent. */
export function installInkWindowControls({ send, isLocked, flush }) {
  const $ = id => document.getElementById(id)
  let state, drag, pending, timer
  function close() { $('size-panel').hidden = true; $('window-size').setAttribute('aria-expanded', 'false') }
  function update(value) {
    if (!value) return
    state = value
    $('window-width').value = Math.round(value.frame.width)
    $('window-height').value = Math.round(value.frame.height)
    $('window-width').max = Math.max(1, value.bounds.width - 24)
    $('window-height').max = Math.max(1, value.bounds.height - 60)
    $('window-width').min = Math.min(360, Number($('window-width').max))
    $('window-height').min = Math.min(340, Number($('window-height').max))
  }
  window.cardlinkInkLayout = update
  function apply(frame) { if (!state || isLocked()) return; flush(); send(frame) }
  function commit() { clearTimeout(timer); timer = null; if (pending) { const value = pending; pending = null; apply(value) } }
  function stop(cancelled = false) {
    if (cancelled) { clearTimeout(timer); timer = null; pending = null } else commit()
    drag = null
  }
  for (const [id, mode] of [['window-drag', 'move'], ['resize-grip', 'resize']]) {
    const element = $(id)
    element.addEventListener('pointerdown', event => {
      if (!state || isLocked() || event.button !== 0 || event.isPrimary === false) return
      event.preventDefault(); flush(); close()
      drag = { id: event.pointerId, mode, x: event.screenX, y: event.screenY, frame: { ...state.frame } }
      element.setPointerCapture(event.pointerId)
    })
    element.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return
      const dx = event.screenX - drag.x, dy = event.screenY - drag.y
      pending = { ...drag.frame, ...(mode === 'move' ? { x: drag.frame.x + dx, y: drag.frame.y + dy } : { width: drag.frame.width + dx, height: drag.frame.height + dy }) }
      if (!timer) timer = setTimeout(commit, 70)
    })
    element.addEventListener('pointerup', event => { if (drag?.id === event.pointerId) stop() })
    element.addEventListener('pointercancel', () => stop(true))
    element.addEventListener('lostpointercapture', () => stop(true))
  }
  $('resize-grip').addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key]
    if (state && delta) { event.preventDefault(); apply({ ...state.frame, width: state.frame.width + delta[0], height: state.frame.height + delta[1] }) }
  })
  $('window-size').onclick = () => {
    if (isLocked()) return
    $('size-panel').hidden = !$('size-panel').hidden
    $('window-size').setAttribute('aria-expanded', String(!$('size-panel').hidden))
  }
  $('size-close').onclick = close
  $('size-form').onsubmit = event => {
    event.preventDefault()
    if (!state) return
    apply({ ...state.frame, width: Number($('window-width').value), height: Number($('window-height').value) })
  }
  document.querySelectorAll('[data-window-preset]').forEach(button => {
    button.onclick = () => {
      if (!state) return
      const sizes = { compact: [480, 540], standard: [840, 660], fill: [state.bounds.width - 24, state.bounds.height - 60] }
      const [width, height] = sizes[button.dataset.windowPreset]
      apply({ x: (state.bounds.width - width) / 2, y: 48, width, height })
    }
  })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('size-panel').hidden) { close(); $('window-size').focus() } })
  document.addEventListener('pointerdown', event => { if (!$('size-panel').contains(event.target) && !$('window-size').contains(event.target)) close() })
  window.addEventListener('pagehide', () => stop(true))
  return { update, close }
}
