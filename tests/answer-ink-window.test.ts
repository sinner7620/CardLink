import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { runInNewContext } from "node:vm"
import { createHash } from "node:crypto"

for (const cardWrite of [false, true]) test(cardWrite
  ? "启用原卡写入时核对批注和未确认的写入"
  : "仅在本机保存最新批注，保留原卡评论并支持重新编辑", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
    export * from './src/answer-ink-window'
    export { saveMatcherSettings } from './src/settings'
    export { exportNavigationRuntimeLog } from './src/note-navigation'
  ` }, bundle: true, write: false, format: "cjs", external: ["marginnote"],
    define: { __ANSWER_INK_SCRIPT__: JSON.stringify("/* editor */"), __APP_VERSION__: JSON.stringify("test"),
      __ANSWER_INK_CARD_WRITE__: JSON.stringify(cardWrite) } })
  const files = new Map<string, string>()
  const capturePath = "/cardlink/web-dist/vendor/html2canvas.min.js"
  const captureSource = "window.html2canvas = function () {}"
  const reads: string[] = []
  const defaults = new Map<string, string>()
  const notes = new Map()
  const manager = { fileExistsAtPath: () => false, createDirectoryAtPathWithIntermediateDirectoriesAttributes: () => true }
  let autosave = () => {}
  let snapshot: any, image: any
  let failWrite = false, deferImage = false
  const deadlines = new Set<() => void>()
  let exportedLog = ""
  const calls: string[] = []
  const scheduled: ((value: unknown) => void)[] = []
  const zoomResets: number[] = []
  class HoverRecognizer {
    state = 1
    zOffset = .75
    cancelsTouchesInView = true
    constructor(private target: any, private action: string) {}
    locationInView() { return { x: 24, y: 80 } }
    fire() { this.target[this.action.replace(/:$/, "")](this) }
  }
  const hovers = new Set<HoverRecognizer>()
  const reader = {
    delegate: null as any,
    addGestureRecognizer(recognizer: HoverRecognizer) { hovers.add(recognizer) },
    removeGestureRecognizer(recognizer: HoverRecognizer) { hovers.delete(recognizer) },
    scrollView: { zoomScale: 2, setZoomScaleAnimated(value: number, animated: boolean) {
      assert.equal(animated, false)
      this.zoomScale = value
      zoomResets.push(value)
    }, scrollEnabled: true, delaysContentTouches: true, canCancelContentTouches: true,
      pinchGestureRecognizer: { enabled: true } },
    evaluateJavaScript(script: string, callback?: (value: unknown) => void) {
      calls.push(script)
      if (script.startsWith(captureSource)) callback?.("function")
      else if (script.includes("cardLinkAnswerInkImage") && callback && !deferImage) callback(JSON.stringify(image))
      else if (callback) scheduled.push(callback)
    },
    navigate(url: string) { return this.delegate.webViewShouldStartLoadWithRequestNavigationType(this, { URL: () => ({ absoluteString: () => url }) }) }
  }
  const reply = () => scheduled.shift()?.(snapshot === undefined ? undefined : JSON.stringify(snapshot))
  const answerNote = { notebookId: "answers", comments: [] as any[],
    appendHtmlComment(html: string, text: string, size: { width: number; height: number }) { this.comments.push({ html, text, size }) } }
  const existingComment = { text: "既有手写批注", html: "<img alt=\"既有手写批注\">" }
  if (!cardWrite) answerNote.comments.push(existingComment)
  notes.set("a1", answerNote)
  notes.set("a2", { notebookId: "answers", comments: [] })
  const late: any[] = []
  const delayedNote = { notebookId: "answers", comments: [] as any[],
    appendHtmlComment(html: string, text: string) { late.push({ html, text }) } }
  notes.set("a3", delayedNote)
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    require: () => ({ MN: { app: { documentPath: "/documents", tempPath: "/tmp", refreshAfterDBChanged() {} },
      db: { getNoteById: (id: string) => notes.get(id) } }, isfileExists: (path: string) => files.has(path), showHUD() {},
      getLocalDataByKey() {}, setLocalDataByKey() {}, saveFile() {}, writeTextFile(_: string, text: string) { exportedLog = text } }),
    self: {},
    UIHoverGestureRecognizer: HoverRecognizer,
    JSB: { defineClass: (_: string, methods: any) => ({ new: () => methods }) },
    NSTimer: { scheduledTimerWithTimeInterval(_: number, repeat: boolean, callback: () => void) {
      if (repeat) autosave = callback
      else deadlines.add(callback)
      return { invalidate() { if (repeat) autosave = () => {}; else deadlines.delete(callback) } }
    } },
    NSFileManager: { defaultManager: () => manager },
    NSUserDefaults: { standardUserDefaults: () => ({ objectForKey: (key: string) => defaults.get(key),
      setObjectForKey: (data: string, key: string) => defaults.set(key, data) }) },
    NSData: { dataWithContentsOfFile: (path: string) => {
        reads.push(path)
        return { base64Encoding: () => Buffer.from(path === capturePath ? captureSource : files.get(path)!).toString("base64") }
      },
      dataWithStringEncoding: (data: string) => ({ base64Encoding: () => Buffer.from(data).toString("base64"), writeToFileAtomically(path: string, atomic: boolean) {
        assert.equal(atomic, true)
        if (failWrite) return false
        files.set(path, data)
        return true
      } }) },
    UndoManager: { sharedInstance: () => ({ undoGrouping(_: string, notebook: string, operation: () => void) {
      assert.equal(notebook, "answers")
      operation()
    } }) }
  })
  const { answerInkDocument, closeAnswerInk, saveMatcherSettings, exportNavigationRuntimeLog } = module.exports as
    typeof import("../src/answer-ink-window") & typeof import("../src/settings") & typeof import("../src/note-navigation")
  const key = (id: string) => JSON.stringify(["questions", "question", "answers", id])
  const hitWidths: number[] = []
  const owner = { mainPath: "/cardlink", answerCardWebView: reader, answerCardAnnotationKey: key("a1"), answerInkHitAreaChanged(width: number) { hitWidths.push(width) } }
  const html = '<html><body><article class="card">答案</article><!-- </body> --></body></html>'
  const open = () => {
    const document = answerInkDocument(owner, html)
    return { document, config: JSON.parse(document.match(/cardLinkAnswerInkConfig=(.*?);\/\* editor \*\//)![1]) }
  }
  const scheme = "cardlink-answer-ink://"
  const hostGestures = (enabled: boolean) => ({ ...reader.scrollView, zoomScale: 1, scrollEnabled: enabled, delaysContentTouches: enabled,
    canCancelContentTouches: enabled, pinchGestureRecognizer: { enabled } })
  const first = open()
  assert.equal(first.config.debug, undefined)
  assert.match(first.document, /<article class="card">答案<\/article>/)
  assert.match(first.document, /<!-- <\/body> --><script>window\.cardLinkAnswerInkConfig=/)
  assert.equal(reader.navigate("https://example.com"), true)
  reader.navigate(scheme + "hit/36?" + first.config.token)
  reader.navigate(scheme + "hit/144?" + first.config.token)
  reader.navigate(scheme + "hit/36?" + first.config.token)
  reader.navigate(scheme + "hit/248?" + first.config.token)
  reader.navigate(scheme + "hit/249?" + first.config.token)
  reader.navigate(scheme + "hit/150?outdated")
  assert.deepEqual(hitWidths, [36, 144, 36, 248])
  reader.navigate(scheme + "start?" + first.config.token)
  assert.deepEqual(zoomResets, [1])
  assert.deepEqual(reader.scrollView, hostGestures(false))
  assert.equal(hovers.size, 1)
  const hover = [...hovers][0]!
  assert.equal(hover.cancelsTouchesInView, false)
  hover.fire()
  assert.match(calls[calls.length - 1], /cardLinkAnswerInkHover\(24,80,0\.75\)/)
  hover.state = 3
  hover.fire()
  assert.match(calls[calls.length - 1], /cardLinkAnswerInkHover\(null,null,null\)/)
  const style = { engine: "goodnotes-ink-v2", size: 4, pressure: true, color: "#dc2626" }
  const answer = { height: 900, strokes: [[[12, 20, .5, 0]]], styles: [style] }
  const anchor = { key: "IMG:sample:1", rect: [22, 160, 600, 800] }
  const highlight = { engine: "drawesome-highlighter-v1", kind: "marker", size: 24, pressure: false, color: "#facc15" }
  snapshot = { token: first.config.token, revision: 1, settingsRevision: 1,
    answer: { ...answer, strokes: [...answer.strokes, [[40, 80, .5, 0], [90, 80, .5, 10]]],
      styles: [{ ...style, anchor }, highlight] }, settings: { size: 4 } }
  const firstSnapshot = snapshot
  autosave()
  assert.equal(scheduled.length, 0, "normal editing must not poll the WebView for a draft")
  reader.navigate(scheme + "checkpoint?" + first.config.token)
  assert.match(calls[calls.length - 1], /cardLinkAnswerInkSnapshot\(false,0,0,false,false\)/)
  reply()
  assert.equal(files.size, 1)
  assert.deepEqual(JSON.parse([...files.values()][0]).answer.styles[0].anchor, anchor)
  assert.deepEqual(JSON.parse([...files.values()][0]).answer.styles[1], highlight)
  assert.equal(defaults.size, 1)

  const red = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
  const blue = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
  let attempt = 0
  function prepare(token: string) {
    const id = ++attempt
    reader.navigate(scheme + `prepare/${id}?` + token)
    reply()
    return id
  }
  const publish = (token: string, id = prepare(token)) => reader.navigate(scheme + `publish/${id}?` + token)
  const receipt = (config: { group: string }) => JSON.parse(
    [...files.entries()].find(([path]) => path.endsWith(`/${config.group}.publication.json`))![1])
  image = { image: red, width: 1, height: 1, revision: 1, inkPixels: true }
  snapshot = { token: first.config.token, revision: 1, settingsRevision: 1 }
  publish(first.config.token, 999)
  assert.equal(answerNote.comments.length, Number(!cardWrite))
  snapshot = firstSnapshot
  const beforePrepare = reads.length
  const firstAttempt = prepare(first.config.token)
  assert.deepEqual(reads.slice(beforePrepare), [...files.keys(), capturePath], "prepare reads the draft and loads the shared screenshot script")
  publish(first.config.token, firstAttempt)
  assert.equal(answerNote.comments.length, 1)
  if (cardWrite) {
    assert.equal(answerNote.comments[0].text, "答案批注")
    assert.match(answerNote.comments[0].html, /^<img id="cardlink-answer-ink-[a-f0-9-]+" alt="答案批注" width="1" height="1"/)
    assert.deepEqual({ ...answerNote.comments[0].size }, { width: 1, height: 1 })
  } else {
    assert.deepEqual(answerNote.comments, [existingComment])
    assert.match(calls[calls.length - 1], /已保存到本机/)
  }
  assert.equal(receipt(first.config).state, cardWrite ? "verified" : "local")
  assert.deepEqual(reader.scrollView, hostGestures(false))
  assert.equal(calls.some(call => call.includes("cardLinkAnswerInkPublishResult")), true)
  snapshot = { token: first.config.token, revision: 1, settingsRevision: 1 }
  publish(first.config.token)
  assert.equal(answerNote.comments.length, 1)
  assert.equal(reads.filter(path => path === capturePath).length, 1, "later saves reuse the capture script")
  image.revision = 2
  publish(first.config.token)
  assert.equal(answerNote.comments.length, 1, "reject an image without the corresponding saved draft")
  assert.match(calls[calls.length - 1], /批注图片无效或与草稿不同步/)
  failWrite = true
  snapshot = { ...snapshot, revision: 2, answer: { ...answer, height: 901 } }
  publish(first.config.token)
  assert.match(calls[calls.length - 1], /cardLinkAnswerInkPrepared.*保存草稿失败/)
  assert.equal(answerNote.comments.length, 1)
  failWrite = false
  for (let revision = 2; revision <= 11; revision++) {
    snapshot = { ...snapshot, revision, answer: { ...answer, height: 900 + revision } }
    image = { ...image, image: blue, revision }
    publish(first.config.token)
  }
  assert.equal(answerNote.comments.length, 1, "the original survives until the host can verify a replacement")
  if (cardWrite) assert.match(answerNote.comments[0].html, /nGP4z8/)
  else assert.deepEqual(answerNote.comments, [existingComment])
  assert.equal(receipt(first.config).state, cardWrite ? "pending" : "local")
  assert.equal(receipt(first.config).image, blue)
  assert.equal(receipt(first.config).sequence, 11)

  const legacy = createHash("sha256").update(key("a2")).digest("hex")
  const directory = [...files.keys()][0].replace(/[^/]+$/, "")
  files.set(directory + legacy + ".json", JSON.stringify({ version: 1, answer: { ...answer, width: 500 }, settings: { size: 2 } }))
  snapshot = { token: first.config.token, revision: 11, settingsRevision: 1 }
  closeAnswerInk(owner); reply()
  assert.equal(hovers.size, 0)
  const callsAfterClose = calls.length
  hover.fire()
  assert.equal(calls.length, callsAfterClose)
  assert.deepEqual(reader.scrollView, hostGestures(true))
  owner.answerCardAnnotationKey = key("a2")
  const next = open()
  assert.equal(next.config.answer.strokes[0][0][0], 24)
  assert.equal(next.config.settings.size, 4)
  assert.doesNotMatch(next.document, /data-answer-ink-saved/)
  closeAnswerInk(owner); reply()

  owner.answerCardAnnotationKey = JSON.stringify(["different-questions", "another-question", "answers", "a1"])
  const beforeRestore = reads.length
  const restored = open()
  assert.equal(restored.config.answer.height, 911)
  assert.equal(restored.config.group, first.config.group)
  assert.equal(restored.config.settings.size, 4)
  assert.match(restored.document, /<details class="answer-ink-saved"/)
  assert.doesNotMatch(restored.document, /nGP4z8/)
  assert.doesNotMatch(restored.document, /nGNgYPgP/)
  assert.ok(!reads.slice(beforeRestore).some(path => path.endsWith(".publication.json")))
  reader.navigate(scheme + "preview?" + restored.config.token)
  assert.match(calls[calls.length - 1], /cardLinkAnswerInkPreview\(.*nGNgYPgP/)
  if (!cardWrite) {
    reader.navigate(scheme + "start?" + restored.config.token)
    snapshot = { token: restored.config.token, revision: 0, settingsRevision: 0 }
    const captureReads = reads.filter(path => path === capturePath).length
    const unchanged = prepare(restored.config.token)
    assert.match(calls[calls.length - 1], new RegExp(`cardLinkAnswerInkPrepared\\(${unchanged},"",true\\)`))
    assert.equal(reads.filter(path => path === capturePath).length, captureReads)
    reader.navigate(scheme + "end?" + restored.config.token); reply()
  }

  closeAnswerInk(owner); reply()
  saveMatcherSettings({ debugModeEnabled: true })
  const debugging = open()
  assert.equal(debugging.config.debug, true)
  reader.navigate(scheme + "start?" + debugging.config.token)
  const responsesBefore = calls.filter(call => call.includes("cardLinkAnswerInkResult")).length
  snapshot = { token: debugging.config.token, revision: 0, settingsRevision: 0,
    diagnostics: { dropped: 2, events: [[1, 10, "raw.pointerdown", "pen", 7], [2, 22, "route.end", "pen", 7, "pointercancel"],
      [3, 22, "raw.pointerup", "private answer text"]] } }
  autosave(); reply()
  assert.ok(calls.some(call => /cardLinkAnswerInkSnapshot\(false,.*false,true\)/.test(call)))
  assert.equal(calls.filter(call => call.includes("cardLinkAnswerInkResult")).length, responsesBefore)
  exportNavigationRuntimeLog()
  assert.match(exportedLog, /\[答案书写\].*trace\.dropped=2/)
  assert.match(exportedLog, /raw\.pointerdown pen 7.*route\.end pen 7 pointercancel/)
  assert.match(exportedLog, /host\.touch-delay immediate/)
  assert.match(exportedLog, /host\.scroll disabled/)
  assert.match(exportedLog, /host\.pinch disabled/)
  assert.doesNotMatch(exportedLog, /private answer text/)
  snapshot = undefined
  reader.navigate(scheme + "end?" + debugging.config.token); reply()
  assert.deepEqual(reader.scrollView, hostGestures(true))
  reader.navigate(scheme + "start?" + debugging.config.token)
  assert.deepEqual(reader.scrollView, hostGestures(false))
  let closed = false
  closeAnswerInk(owner, () => { closed = true }); reply()
  assert.equal(closed, false, "an unconfirmed draft prevents the editor being unloaded")
  assert.deepEqual(reader.scrollView, hostGestures(false))
  snapshot = { token: debugging.config.token, revision: 0, settingsRevision: 0 }
  closeAnswerInk(owner, () => { closed = true }); reply()
  assert.equal(closed, true)
  assert.deepEqual(reader.scrollView, hostGestures(true))

  const canonical = directory + first.config.group + ".json"
  files.set(canonical, "damaged")
  const recovered = open()
  assert.equal(recovered.config.answer.height, 910, "a damaged active draft falls back to the last verified revision")
  closeAnswerInk(owner); reply()

  owner.answerCardAnnotationKey = key("a3")
  const delayed = open()
  const token = delayed.config.token
  reader.navigate(scheme + "start?" + token)
  snapshot = { token, revision: 1, settingsRevision: 0, answer }
  image = { image: red, width: 1, height: 1, revision: 1, inkPixels: true }
  deferImage = true
  publish(token)
  assert.equal(deadlines.size, 1)
  ;[...deadlines][0]()
  assert.match(calls[calls.length - 1], /宿主响应超时/)
  reply()
  assert.equal(late.length, 0, "a late image callback must not write a comment")
  deferImage = false

  publish(token)
  assert.equal(late.length, Number(cardWrite))
  assert.equal(receipt(delayed.config).state, cardWrite ? "pending" : "local")
  assert.equal(receipt(delayed.config).outstanding, cardWrite ? receipt(delayed.config).imageHash : undefined)
  snapshot = { token, revision: 1, settingsRevision: 0 }
  closeAnswerInk(owner); reply()
  const reopened = open()
  reader.navigate(scheme + "start?" + reopened.config.token)
  snapshot = { token: reopened.config.token, revision: 0, settingsRevision: 0 }
  image = { ...image, revision: 0 }
  publish(reopened.config.token)
  assert.equal(late.length, Number(cardWrite), "reopening must not trigger a duplicate append")
  if (cardWrite) delayedNote.comments.push(late[0])
  publish(reopened.config.token)
  assert.equal(late.length, Number(cardWrite))
  assert.equal(receipt(reopened.config).state, cardWrite ? "verified" : "local")
  assert.equal(receipt(reopened.config).outstanding, undefined)
})
