import type { MbBookNote, StudyController } from "marginnote"
import { answerPreviewDocument } from "./answer-preview-mode"
import { renderCardHtml } from "./card-html"

declare const __PROBE_INK_SCRIPT__: string
declare const __PROBE_REPORT_SCRIPT__: string

const commandPrefix = "cardlink-answer-ink://"
const sample = {
  noteId: "webview-probe-sample",
  noteTitle: "Apple Pencil 书写测试",
  excerptText: "点「批注」，用 Apple Pencil 在下方方格从左至右画 10 个圈。结束后截图，保留页面底部的计数。",
  comments: [{
    type: "HtmlNote",
    html: '<figure style="height:420px;margin:0;border:1px solid #ced9e8;background-color:#fff;background-image:linear-gradient(#dfe7f2 1px,transparent 1px),linear-gradient(90deg,#dfe7f2 1px,transparent 1px);background-size:32px 32px"></figure>',
  }],
}

function selectedNote(study: StudyController): MbBookNote | undefined {
  return study.notebookController?.mindmapView?.selViewLst?.[0]?.note?.note
}

function documentFor(note: MbBookNote | undefined, scene = false): string {
  const db = note && Database.sharedInstance()
  const media = (hash: string) => {
    try { return String(db?.getMediaByHash(hash)?.base64Encoding() || "") || undefined }
    catch { return undefined }
  }
  const html = renderCardHtml(note || sample, "最小 WebView 测试", id => db?.getNoteById(id),
    media, media, false, true, true, { excludeAnswerInk: true })
  const document = answerPreviewDocument(html)
    .replace("</head>", `<style>
      html { -webkit-text-size-adjust: none; text-size-adjust: none }
      .card .text-block, .card .html-block { font-size: 12pt }
    </style></head>`)
  if (scene) return document.replace("<html>", '<html lang="zh-CN">')
    .replace("<head>", '<head><meta charset="UTF-8"><title>CardLink 场景书写测试</title>')
    .replace("<body>", '<body data-probe-mount="scene">')
    .replace("</body>", '<script src="/pkg/scene-config.js"></script>' +
      '<script src="/pkg/answer-ink.js"></script><script src="/pkg/probe-report.js"></script></body>')
  return document.replace("</body>", () =>
    '<script>window.cardLinkAnswerInkConfig={token:"webview-probe",debug:true};' + __PROBE_INK_SCRIPT__ +
    '</script><script>' + __PROBE_REPORT_SCRIPT__ + '</script></body>')
}

export function sceneDocument(): string { return documentFor(undefined, true) }

export function rawDocument(browser = false): string {
  const options = browser ? "" :
    '<p><label><input type="checkbox" data-native-default> 保留 WebView 原生触摸设置</label></p>' +
    '<p>每轮开始后用手指轻点一次空白处，再用 Pencil 画 20 个圈。</p>'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=0.6,maximum-scale=3,user-scalable=yes">
    <style>
      html,body { margin:0;height:100%;background:#fff;font:16px system-ui;-webkit-text-size-adjust:none }
      body[data-recording] { touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none }
      main { padding:24px }
      button { font:inherit }
    </style></head><body data-probe-mount="window" data-probe-raw${browser ? " data-probe-browser" : ""}>
    <main><h1>原始 Pencil 事件</h1><p>在空白处画 20 个圈，再点「结束记录」。</p>${options}
    <button type="button" data-mode aria-pressed="false">开始记录</button></main>
    <script>${__PROBE_REPORT_SCRIPT__}</script></body></html>`
}

function frameFor({ width, height }: { width: number; height: number }) {
  const viewWidth = Math.min(837, width - 24)
  const viewHeight = Math.min(655, height - 36)
  return { x: (width - viewWidth) / 2, y: (height - viewHeight) / 2, width: viewWidth, height: viewHeight }
}

function createProbeNavigation(view: UIWebView, studyView: UIView, window: UIView, document: string) {
  let onWindow = false
  let raw = false
  return (command: "switch-host" | "switch-page") => {
    if (command === "switch-host" && !raw) {
      const frame = frameFor(studyView.bounds)
      const parent = onWindow ? studyView : window
      const nextFrame = onWindow ? frame : studyView.convertRectToView(frame, window)
      parent.addSubview(view)
      view.frame = nextFrame
      onWindow = !onWindow
    } else if (command === "switch-page" && onWindow) {
      raw = !raw
    } else return
    const mount = onWindow ? "window" : "study"
    view.loadHTMLStringBaseURL(raw ? rawDocument() : document.replace(
      '<body>', '<body data-probe-mount="' + mount + '">'
    ), null)
  }
}

function setTouchDelivery(view: UIWebView) {
  const scroll = view.scrollView
  let pinch
  try { pinch = scroll.pinchGestureRecognizer } catch { /* Host API may not expose this recognizer. */ }
  const entries = [
    [scroll, "delaysContentTouches"],
    [scroll, "canCancelContentTouches"],
    [pinch, "enabled"],
    [scroll, "scrollEnabled"],
  ] as const
  const previous = entries.map(([target, key]) => {
    try {
      const object = target as unknown as Record<string, boolean> | undefined
      const value = object?.[key]
      if (!object || typeof value !== "boolean") return
      object[key] = false
      return { object, key, value }
    } catch { return undefined }
  })
  const readBack = previous.map(field => {
    try { return field ? Number(field.object[field.key] === false) : null }
    catch { return null }
  })
  view.evaluateJavaScript("window.cardLinkProbeTouchDelivery(" + JSON.stringify(readBack) + ")", () => {})
  return () => {
    for (const field of previous.reverse()) {
      if (!field) continue
      try { field.object[field.key] = field.value } catch { /* This WebView is owned by the probe. */ }
    }
  }
}

export function createProbeAddon() {
  const restores = new WeakMap<object, () => void>()
  const observers = new WeakMap<object, { stop: () => void; result: { pencil: number; finger: number; other: number } }>()
  const navigation = new WeakMap<object, ReturnType<typeof createProbeNavigation>>()
  const pendingSwitches = new WeakSet<object>()
  let TouchObserver: any
  function observe(view: UIWebView) {
    const result = { pencil: 0, finger: 0, other: 0 }
    try {
      TouchObserver ||= JSB.defineClass("CardLinkProbeTouchObserver : NSObject <UIGestureRecognizerDelegate>", {
        ignoreProbeTap() {},
        gestureRecognizerShouldReceiveTouch(_gesture: UIGestureRecognizer, touch: { type?: number }) {
          try {
            const count = self.cardLinkProbeTouchCounts as typeof result | undefined
            if (count) {
              const type = touch?.type
              if (type === 2) count.pencil++
              else if (type === 0) count.finger++
              else count.other++
            }
          } catch { /* Native touch metadata may be opaque to JSB. */ }
          return false
        },
      }, {})
      const delegate = TouchObserver.new()
      delegate.cardLinkProbeTouchCounts = result
      const gesture = new UITapGestureRecognizer(delegate, "ignoreProbeTap:")
      gesture.cancelsTouchesInView = false
      gesture.delaysTouchesBegan = false
      gesture.delaysTouchesEnded = false
      gesture.delegate = delegate
      view.addGestureRecognizer(gesture)
      observers.set(view, { result, stop: () => {
        view.removeGestureRecognizer(gesture)
        gesture.delegate = null
        delegate.cardLinkProbeTouchCounts = null
      } })
    } catch { /* The browser counters still work if the host lacks this bridge. */ }
  }

  const endWriting = (view: UIWebView, report = false) => {
    const observer = observers.get(view)
    const result = observer?.result
    observers.delete(view)
    try { observer?.stop() } catch { /* Restore the WebView settings even if the observer fails to detach. */ }
    restores.get(view)?.()
    restores.delete(view)
    if (report) view.evaluateJavaScript(
      "window.cardLinkProbeNativeResult(" + JSON.stringify(result ?? null) + ")", () => {})
  }
  const Delegate = JSB.defineClass("CardLinkStandaloneProbeDelegate : UIViewController <UIWebViewDelegate>", {
    webViewShouldStartLoadWithRequestNavigationType(view: UIWebView, request: { URL(): { absoluteString(): string } }) {
      const url = String(request.URL().absoluteString())
      if (!url.startsWith(commandPrefix)) return true
      const [path, token] = url.slice(commandPrefix.length).split("?")
      if (token === "webview-probe") {
        const command = path.replace(/\/$/, "")
        if (command === "start" && !restores.has(view)) restores.set(view, setTouchDelivery(view))
        const saveRequest = /^(prepare|publish)\/(\d+)$/.exec(command)
        if (saveRequest) {
          const id = Number(saveRequest[2])
          const callback = saveRequest[1] === "prepare" ? `cardLinkAnswerInkPrepared(${id}, "")` :
            `cardLinkAnswerInkPublishResult("", "probe", "测试图片已生成", ${id})`
          view.evaluateJavaScript("window." + callback, () => {})
        }
        if (command === "end") endWriting(view)
        if ((command === "start-raw" || command === "start-raw-default") && !restores.has(view)) {
          observe(view)
          if (command === "start-raw") restores.set(view, setTouchDelivery(view))
          else {
            restores.set(view, () => {})
            view.evaluateJavaScript("window.cardLinkProbeTouchDelivery(null)", () => {})
          }
        }
        if (command === "end-raw") endWriting(view, true)
        if ((command === "switch-host" || command === "switch-page") &&
            navigation.has(view) && !restores.has(view) && !pendingSwitches.has(view)) {
          pendingSwitches.add(view)
          // Reload after the delegate has returned its decision on this navigation.
          NSTimer.scheduledTimerWithTimeInterval(.05, false, () => {
            pendingSwitches.delete(view)
            const navigate = navigation.get(view)
            if (!navigate) return
            try {
              if (!restores.has(view)) { navigate(command); return }
            } catch { /* Report a failed switch without losing the current diagnostic. */ }
            view.evaluateJavaScript("window.cardLinkProbeSwitchFailed()", () => {})
          })
        }
      }
      return false
    },
  }, {})
  const close = () => {
    const view: UIWebView | undefined = self.cardLinkProbeView
    if (!view) return
    endWriting(view)
    navigation.delete(view)
    view.delegate = null
    view.removeFromSuperview()
    self.cardLinkProbeView = self.cardLinkProbeDelegate = null
  }
  return JSB.defineClass("CardLinkStandaloneWebViewProbe : JSExtension", {
    queryAddonCommandStatus() {
      return { image: "logo.png", object: self, selector: "toggleCardLinkProbe:", checked: !!self.cardLinkProbeView }
    },
    toggleCardLinkProbe() {
      const window = self.window
      const study = Application.sharedInstance().studyController(window)
      if (self.cardLinkProbeView) close()
      else if (study?.view) {
        const document = documentFor(selectedNote(study))
        const view = new UIWebView(frameFor(study.view.bounds))
        view.backgroundColor = UIColor.whiteColor()
        view.scalesPageToFit = true
        const delegate = Delegate.new()
        self.cardLinkProbeView = view
        self.cardLinkProbeDelegate = delegate
        view.delegate = delegate
        navigation.set(view, createProbeNavigation(view, study.view, window, document))
        study.view.addSubview(view)
        view.loadHTMLStringBaseURL(document, null)
      }
      study?.refreshAddonCommands()
    },
    notebookWillClose: close,
    sceneDidDisconnect: close,
  }, {})
}
