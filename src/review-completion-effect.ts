import { pauseControlSurface, syncControlSurface } from './native-control-surface'
import { createWindowSurface } from './window-opacity'

declare const __REVIEW_COMPLETION_SCRIPT__: string

interface CompletionEffect {
  container: UIView
  view: UIWebView
  active: boolean
  ready: boolean
  playing: boolean
  timer?: { invalidate(): void }
  backgroundTimer?: { invalidate(): void }
}

function reducedMotion(): boolean {
  const accessibility = (globalThis as any).UIAccessibility
  return accessibility?.isReduceMotionEnabled === true ||
    (typeof accessibility?.isReduceMotionEnabled === 'function' && accessibility.isReduceMotionEnabled()) === true
}

export function reviewCompletionHtml(script = __REVIEW_COMPLETION_SCRIPT__): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent!important;pointer-events:none}canvas{position:fixed;inset:0;width:100%;height:100%;background:transparent!important;pointer-events:none}</style></head><body><canvas id="review-completion-confetti" aria-hidden="true"></canvas><script>${script}</script></body></html>`
}

/** The host can recreate the WebView's internal white backing during loading. */
function clearEffectBackground(view: any): void {
  view.opaque = false
  view.backgroundColor = UIColor.clearColor()
  for (const child of Array.from(view.subviews ?? [])) clearEffectBackground(child)
}

function refreshEffectTransparency(effect: CompletionEffect): void {
  clearEffectBackground(effect.container)
  // Some hosts do not include scrollView in the bridged subviews array.
  clearEffectBackground((effect.view as any).scrollView)
}

export function disposeReviewCompletionEffect(owner: any): void {
  const effect = owner.cardLinkReviewCompletionEffect as CompletionEffect | undefined
  owner.cardLinkReviewCompletionEffect = undefined
  if (!effect) return
  effect.active = false
  try { effect.timer?.invalidate() } catch { /* detached native timer */ }
  pauseControlSurface(effect.view)
  try { effect.view.evaluateJavaScript('window.setReviewCompletionEffect&&window.setReviewCompletionEffect(false)', () => {}) } catch { /* detached visual layer */ }
  try { effect.view.removeFromSuperview() } catch { /* detached visual layer */ }
  try { (effect.container as any).removeFromSuperview() } catch { /* detached native container */ }
}

function updateEffect(owner: any, effect: CompletionEffect): void {
  syncControlSurface(effect.view, {
    html: () => reviewCompletionHtml(), method: 'setReviewCompletionEffect', args: [effect.playing],
    rootId: 'review-completion-confetti', active: () => effect.active && owner.cardLinkReviewCompletionEffect === effect,
    onReady: () => { refreshEffectTransparency(effect); effect.ready = true }
  })
}

export function prepareReviewCompletionEffect(owner: any, enabled: boolean): void {
  disposeReviewCompletionEffect(owner)
  if (!enabled || reducedMotion()) return
  try {
    // Use the entrance ball's actual native host, including multi-window scenes.
    const ball = owner.mnutilsEntranceBall
    const host = ball?.button?.superview ?? ball?.window ?? owner.window
    if (!host) return
    const container = createWindowSurface({ x: 0, y: 0, width: host.bounds.width, height: host.bounds.height })
    const shell = container as any
    shell.autoresizingMask = (1 << 1) | (1 << 4)
    shell.hidden = true
    shell.opaque = false
    shell.backgroundColor = UIColor.clearColor()
    shell.userInteractionEnabled = false
    shell.accessibilityElementsHidden = true
    const view = new UIWebView({ x: 0, y: 0, width: host.bounds.width, height: host.bounds.height })
    const visual = view as any
    visual.autoresizingMask = (1 << 1) | (1 << 4)
    visual.opaque = false
    // A loading WebView can paint an opaque backing surface on the host.
    // Preloading must never cover the question before completion playback.
    visual.hidden = true
    visual.backgroundColor = UIColor.clearColor()
    visual.userInteractionEnabled = false
    visual.accessibilityElementsHidden = true
    visual.scrollView.opaque = false
    visual.scrollView.backgroundColor = UIColor.clearColor()
    visual.scrollView.scrollEnabled = false
    visual.scrollView.bounces = false
    visual.scrollView.userInteractionEnabled = false
    visual.scrollView.contentInsetAdjustmentBehavior = 2
    const effect: CompletionEffect = { container, view, active: true, ready: false, playing: false }
    owner.cardLinkReviewCompletionEffect = effect
    container.addSubview(view)
    host.addSubview(container)
    updateEffect(owner, effect)
  } catch { disposeReviewCompletionEffect(owner) }
}

export function playReviewCompletionEffect(owner: any, enabled: boolean): () => void {
  const effect = owner.cardLinkReviewCompletionEffect as CompletionEffect | undefined
  const stop = () => {
    if (effect && owner.cardLinkReviewCompletionEffect === effect) disposeReviewCompletionEffect(owner)
  }
  if (!effect) return stop
  if (!enabled || reducedMotion() || !effect.ready || !(effect.container as any).superview) { stop(); return stop }
  if (effect.playing) return stop
  try {
    effect.playing = true
    refreshEffectTransparency(effect)
    ;(effect.container as any).superview.bringSubviewToFront(effect.container)
    updateEffect(owner, effect)
    ;(effect.view as any).hidden = false
    ;(effect.container as any).hidden = false
    effect.timer = NSTimer.scheduledTimerWithTimeInterval(5, false, stop)
  } catch { stop() }
  return stop
}
