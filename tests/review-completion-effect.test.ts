import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { transpileModule } from 'typescript'
import { windowOpacityFixture } from './window-opacity-fixture'

function load(file: string, globals: Record<string, any>, modules: Record<string, any> = {}) {
  const context = { ...globals, exports: {} as any, require: (name: string) => modules[name] ?? {} }
  runInNewContext(transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  return context.exports
}

function harness(options: { reduced?: boolean | (() => boolean), deferred?: boolean, failCreate?: boolean } = {}) {
  const views: any[] = [], timers: any[] = []
  class NativeView {
    frame: any
    superview: any
    subviews: any[] = []
    layer: any = {}
    removed = false
    constructor(frame: any) { this.frame = frame }
    addSubview(view: any) { view.superview = this; this.subviews.push(view) }
    removeFromSuperview() { this.removed = true; this.superview = undefined }
  }
  class WebView {
    frame: any
    scrollView: any = {}
    delegate: any
    superview: any
    html = ''
    scripts: string[] = []
    removed = false
    failReset = false
    failRemove = false
    subviews: any[] = []
    constructor(frame: any) {
      if (options.failCreate) throw new Error('webview unavailable')
      this.frame = frame
      views.push(this)
    }
    loadHTMLStringBaseURL(html: string) {
      this.html = html
      this.subviews = [{ opaque: true, backgroundColor: 'white', subviews: [{ opaque: true, backgroundColor: 'white' }] }]
      this.scrollView.backgroundColor = 'white'
      if (!options.deferred) this.delegate.webViewDidFinishLoad(this)
    }
    evaluateJavaScript(script: string, callback?: (value: string) => void) {
      if (this.failReset && script.includes('Effect(false)')) throw new Error('reset failed')
      this.scripts.push(script)
      callback?.('cardlink-control-ready')
    }
    removeFromSuperview() {
      this.removed = true
      this.superview = undefined
      if (this.failRemove) throw new Error('remove failed')
    }
  }
  const accessibility = { isReduceMotionEnabled: options.reduced ?? false }
  const globals = {
    UIWebView: WebView, UIColor: { clearColor: () => 'transparent' }, UIAccessibility: accessibility,
    __REVIEW_COMPLETION_SCRIPT__: 'window.setReviewCompletionEffect=function(){};',
    JSB: { defineClass: (_name: string, methods: any) => ({ new: () => methods }) },
    NSTimer: { scheduledTimerWithTimeInterval: (seconds: number, repeat: boolean, callback: () => void) => {
      const timer = { seconds, repeat, callback, invalidated: false, invalidate() { this.invalidated = true } }
      timers.push(timer)
      return timer
    } }
  }
  const surface = load('src/native-control-surface.ts', globals)
  const api = load('src/review-completion-effect.ts', globals, {
    './native-control-surface': surface, './window-opacity': windowOpacityFixture(NativeView)
  })
  const host = { bounds: { width: 768, height: 1024 }, fronts: [] as any[],
    addSubview(view: any) { view.superview = this }, bringSubviewToFront(view: any) { this.fronts.push(view) } }
  const owner: any = { window: host }
  return { api, owner, host, views, timers, accessibility }
}

function playingScripts(view: any) {
  return view.scripts.filter((script: string) => script.includes('fn.apply(window,[true])'))
}

test('completion layer preloads transparently without consuming touch or accessibility', () => {
  const { api, owner, views, host } = harness()
  api.prepareReviewCompletionEffect(owner, true)
  const view = views[0]
  assert.deepEqual(JSON.parse(JSON.stringify(view.frame)), { x: 0, y: 0, ...host.bounds })
  assert.equal(view.opaque, false)
  const container = owner.cardLinkReviewCompletionEffect.container
  assert.equal(container.superview, host)
  assert.equal(view.superview, container)
  assert.equal(container.hidden, true)
  assert.equal(container.opaque, false)
  assert.equal(container.backgroundColor, 'transparent')
  assert.equal(container.userInteractionEnabled, false)
  assert.equal(container.accessibilityElementsHidden, true)
  assert.equal(view.subviews[0].backgroundColor, 'transparent')
  assert.equal(view.subviews[0].subviews[0].backgroundColor, 'transparent')
  assert.equal(view.scrollView.backgroundColor, 'transparent')
  assert.equal(view.hidden, true, 'preloading cannot cover the active review question')
  assert.equal(view.userInteractionEnabled, false)
  assert.equal(view.accessibilityElementsHidden, true)
  assert.equal(view.scrollView.userInteractionEnabled, false)
  assert.equal(view.scrollView.scrollEnabled, false)
  assert.equal(owner.cardLinkReviewCompletionEffect.ready, true)
  assert.equal(playingScripts(view).length, 0)
  assert.match(view.html, /pointer-events:none/)
})

test('completion plays once and dismissal invalidates its timeout and removes the layer', () => {
  const { api, owner, views, timers, host } = harness()
  api.prepareReviewCompletionEffect(owner, true)
  const container = owner.cardLinkReviewCompletionEffect.container
  views[0].subviews[0].backgroundColor = 'white'
  const stop = api.playReviewCompletionEffect(owner, true)
  api.playReviewCompletionEffect(owner, true)
  assert.equal(views[0].hidden, false, 'the layer only becomes visible for completion')
  assert.equal(container.hidden, false)
  assert.equal(host.fronts[0], container)
  assert.equal(views[0].subviews[0].backgroundColor, 'transparent')
  assert.equal(playingScripts(views[0]).length, 1)
  assert.equal(host.fronts.length, 1)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].seconds, 5)
  assert.equal(timers[0].repeat, false)
  stop()
  stop()
  assert.equal(timers[0].invalidated, true)
  assert.equal(views[0].removed, true)
  assert.equal(container.removed, true)
  assert.equal(owner.cardLinkReviewCompletionEffect, undefined)
})

test('effect uses the entrance ball native host rather than another scene window', () => {
  const { api, owner, host } = harness()
  owner.mnutilsEntranceBall = { button: { superview: host } }
  owner.window = { bounds: { width: 1, height: 1 }, addSubview() { assert.fail('wrong scene') } }
  api.prepareReviewCompletionEffect(owner, true)
  const effect = owner.cardLinkReviewCompletionEffect
  assert.equal(effect.container.superview, host)
  assert.equal(effect.view.frame.width, 768)
  api.playReviewCompletionEffect(owner, true)()
  assert.equal(effect.container.removed, true)
})

test('timeout and stale dismissal callbacks cannot remove a new session layer', () => {
  const { api, owner, views, timers } = harness()
  api.prepareReviewCompletionEffect(owner, true)
  const oldStop = api.playReviewCompletionEffect(owner, true)
  api.prepareReviewCompletionEffect(owner, true)
  oldStop()
  timers[0].callback()
  assert.equal(views[0].removed, true)
  assert.equal(views[1].removed, false)
  api.playReviewCompletionEffect(owner, true)
  timers[1].callback()
  assert.equal(views[1].removed, true)
})

test('disabled preference, reduced motion and unavailable host skip optional effect', () => {
  for (const reduced of [true, () => true]) {
    const h = harness({ reduced })
    h.api.prepareReviewCompletionEffect(h.owner, true)
    assert.equal(h.views.length, 0)
    assert.doesNotThrow(() => h.api.playReviewCompletionEffect(h.owner, true)())
  }
  const h = harness()
  h.api.prepareReviewCompletionEffect(h.owner, false)
  h.api.prepareReviewCompletionEffect({}, true)
  assert.equal(h.views.length, 0)
  const failed = harness({ failCreate: true })
  assert.doesNotThrow(() => failed.api.prepareReviewCompletionEffect(failed.owner, true))
})

test('unready or newly disabled layer is discarded without delayed playback', () => {
  const h = harness({ deferred: true })
  h.api.prepareReviewCompletionEffect(h.owner, true)
  h.api.playReviewCompletionEffect(h.owner, true)
  h.views[0].delegate.webViewDidFinishLoad(h.views[0])
  assert.equal(h.views[0].removed, true)
  assert.equal(playingScripts(h.views[0]).length, 0)
  const ready = harness()
  ready.api.prepareReviewCompletionEffect(ready.owner, true)
  ready.api.playReviewCompletionEffect(ready.owner, false)
  assert.equal(ready.views[0].removed, true)
  assert.equal(ready.timers.length, 0)
  ready.api.prepareReviewCompletionEffect(ready.owner, true)
  ready.accessibility.isReduceMotionEnabled = true
  ready.api.playReviewCompletionEffect(ready.owner, true)
  assert.equal(ready.views[1].removed, true)
})

test('optional cleanup failure still releases state and attempts view removal', () => {
  const h = harness()
  h.api.prepareReviewCompletionEffect(h.owner, true)
  h.api.playReviewCompletionEffect(h.owner, true)
  h.timers[0].invalidate = () => { throw new Error('timer detached') }
  h.views[0].failReset = true
  h.views[0].failRemove = true
  assert.doesNotThrow(() => h.api.disposeReviewCompletionEffect(h.owner))
  assert.equal(h.owner.cardLinkReviewCompletionEffect, undefined)
  assert.equal(h.views[0].removed, true)
})

test('browser effect uses the official five-burst Realistic Look recipe and resets on exit', async () => {
  const bursts: any[] = [], listeners: Record<string, () => void> = {}
  let resets = 0, createOptions: any, chosenCanvas: any
  const fire: any = (options: any) => { bursts.push(options); return Promise.resolve() }
  fire.reset = () => { resets++ }
  const canvas = {}, window: any = { addEventListener: (name: string, fn: () => void) => { listeners[name] = fn } }
  const api = load('web/review-completion-effect.js', {
    window, document: { getElementById: () => canvas }
  }, { 'canvas-confetti': { default: { create: (element: any, options: any) => {
    chosenCanvas = element; createOptions = options; return fire
  } } } })
  assert.equal(chosenCanvas, canvas)
  assert.deepEqual(JSON.parse(JSON.stringify(createOptions)), { resize: true, disableForReducedMotion: true })
  window.setReviewCompletionEffect(false)
  assert.equal(bursts.length, 0)
  window.setReviewCompletionEffect(true)
  window.setReviewCompletionEffect(true)
  assert.deepEqual(JSON.parse(JSON.stringify(bursts)), [
    { origin: { y: 0.7 }, spread: 26, startVelocity: 55, particleCount: 50 },
    { origin: { y: 0.7 }, spread: 60, particleCount: 40 },
    { origin: { y: 0.7 }, spread: 100, decay: 0.91, scalar: 0.8, particleCount: 70 },
    { origin: { y: 0.7 }, spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2, particleCount: 20 },
    { origin: { y: 0.7 }, spread: 120, startVelocity: 45, particleCount: 20 }
  ])
  window.setReviewCompletionEffect(false)
  listeners.pagehide()
  assert.equal(resets, 3)
  await api.fireRealisticLook(() => Promise.resolve())
})
