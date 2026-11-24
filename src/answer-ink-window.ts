import { MN, showHUD } from "marginnote"
import { sha256Hex } from "./content-fingerprint"
import { decodeBase64Utf8 } from "./base64"
import { appendToHtmlBody } from "./html-utils"
import { loadMatcherSettings } from "./settings"
import { recordRuntimeObservation } from "./note-navigation"
import { ANSWER_INK_MAX_WIDTH } from "./window-controls"
import { answerInkCommentIdentity, answerInkCommentMarker } from "./answer-ink-comment"
import { hasAnswerInkPublication, isAnswerInkPng, loadDraft, loadPublication, pngDimensions, saveDraft, savePublication, validateAnswer,
  type Draft, type Publication } from "./answer-ink-storage"

declare const __ANSWER_INK_SCRIPT__: string
declare const __ANSWER_INK_CARD_WRITE__: boolean
declare const UIHoverGestureRecognizer: new (target: any, action: string) => any

interface Reader {
  owner: any; view: any; group: string; token: string; noteId: string; notebookId: string
  saved: number; attempted: number; settingsRevision: number; editing: boolean; closing: boolean; debug: boolean
  saving: boolean; publishing: boolean; flushPending?: boolean; checkpointPending?: boolean; next?: () => void; debugFrame?: string
  draft?: Draft; pendingPrepare?: number; prepared?: { id: number; revision: number; digest: string }
  restoreTouchDelivery?: () => void
  timer?: ReturnType<typeof NSTimer.scheduledTimerWithTimeInterval>
  captureReady?: boolean
  hoverRecognizer?: any; lastHoverAt?: number
}

const prefix = "cardlink-answer-ink://"
const settingsKey = "CardLink.answerInkTools.v1"
const readers = new WeakMap<object, Reader>()
const hoverReaders = new WeakMap<object, Reader>()
const drafts = new Map<string, any>()
let Delegate: any
let delegate: any
let generation = 0

function toolSettings(): Record<string, unknown> | undefined {
  try { return JSON.parse(String(NSUserDefaults.standardUserDefaults().objectForKey(settingsKey) || "null")) || undefined }
  catch { return undefined }
}

function evaluate(reader: Reader, command: string, callback?: (value: unknown) => void): void {
  reader.view.evaluateJavaScript(command, callback || null)
}

function evaluateTimed(reader: Reader, command: string, complete: (value: unknown, error?: string) => void): void {
  let settled = false
  const done = (value: unknown, error?: string) => {
    if (settled) return
    settled = true
    timer.invalidate()
    complete(value, error)
  }
  const timer = NSTimer.scheduledTimerWithTimeInterval(8, false, () => done(undefined, "宿主响应超时，请重试"))
  try { evaluate(reader, command, value => done(value)) }
  catch { done(undefined, "无法读取批注窗口，请重试") }
}

function reply(reader: Reader, callback: string, ...args: unknown[]): void {
  if (readers.get(reader.view) !== reader || reader.closing) return
  try { evaluate(reader, "window." + callback + "(" + args.map(value => JSON.stringify(value)).join(",") + ")") }
  catch { inkLog(reader, "host.reply-failed") }
}

function replyPrepared(reader: Reader, id: number, error: string): void {
  const callback = "cardLinkAnswerInkPrepared"
  if (error || reader.captureReady) {
    reply(reader, callback, id, error)
    return
  }

  try {
    const script = NSData.dataWithContentsOfFile(`${reader.owner.mainPath}/web-dist/vendor/html2canvas.min.js`)
    if (!script) throw new Error("找不到批注截图库")
    const source = decodeBase64Utf8(String(script.base64Encoding()))
    evaluateTimed(reader, source + '\n;typeof window.html2canvas', (kind, problem) => {
      reader.captureReady = String(kind) === "function" && !problem
      reply(reader, callback, id, reader.captureReady ? "" : "批注截图库加载失败，请重试")
    })
  } catch {
    reply(reader, callback, id, "批注截图库加载失败，请重试")
  }
}

function allowsCardWrite(): boolean {
  return typeof __ANSWER_INK_CARD_WRITE__ !== "undefined" && __ANSWER_INK_CARD_WRITE__
}

function inkLog(reader: Reader, message: string): void {
  if (reader.debug) recordRuntimeObservation("答案书写", `session=${reader.token} ${message}`)
}

function stopPencilHover(reader: Reader): void {
  const recognizer = reader.hoverRecognizer
  if (!recognizer) return
  reader.hoverRecognizer = undefined
  hoverReaders.delete(recognizer)
  try { reader.view.removeGestureRecognizer(recognizer) }
  catch { inkLog(reader, "host.hover-remove unavailable") }
}

function startPencilHover(reader: Reader): void {
  if (reader.hoverRecognizer) return
  if (typeof UIHoverGestureRecognizer !== "function") { inkLog(reader, "host.hover unavailable"); return }
  try {
    const recognizer = new UIHoverGestureRecognizer(delegate, "onAnswerInkPencilHover:")
    recognizer.cancelsTouchesInView = false
    reader.view.addGestureRecognizer(recognizer)
    reader.hoverRecognizer = recognizer
    reader.lastHoverAt = undefined
    hoverReaders.set(recognizer, reader)
    inkLog(reader, "host.hover attached")
  } catch { inkLog(reader, "host.hover unavailable") }
}

function onAnswerInkPencilHover(recognizer: any): void {
  const reader = hoverReaders.get(recognizer)
  if (!reader?.editing || reader.closing || reader.publishing) return
  try {
    const state = Number(recognizer.state)
    if (state >= 3) { reply(reader, "cardLinkAnswerInkHover", null, null, null); return }
    if (state !== 1 && state !== 2) return
    const z = recognizer.zOffset
    if (typeof z !== "number" || !(z >= 0 && z <= 1)) return
    const now = Date.now()
    if (reader.lastHoverAt !== undefined && now - reader.lastHoverAt < 32) return
    const point = recognizer.locationInView(reader.view)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    reader.lastHoverAt = now
    reply(reader, "cardLinkAnswerInkHover", point.x, point.y, z)
  } catch { stopPencilHover(reader); inkLog(reader, "host.hover-distance unavailable") }
}

function setInkTouchDelivery(reader: Reader, editing: boolean): void {
  if (!editing) {
    const restore = reader.restoreTouchDelivery
    reader.restoreTouchDelivery = undefined
    restore?.()
    return
  }
  if (reader.restoreTouchDelivery) return
  const restores: (() => void)[] = []
  function disable(target: any, property: string, label: string, applied = "disabled"): void {
    try {
      const original = target?.[property]
      if (typeof original !== "boolean") { inkLog(reader, `${label} unavailable`); return }
      if (!original) { inkLog(reader, `${label} already-disabled`); return }
      restores.push(() => {
        try {
          target[property] = original
          inkLog(reader, `${label} ${target[property] === original ? "restored" : "restore-ignored"}`)
        } catch { inkLog(reader, `${label} restore-failed`) }
      })
      target[property] = false
      inkLog(reader, `${label} ${target[property] === false ? applied : "ignored"}`)
    } catch { inkLog(reader, `${label} unavailable`) }
  }
  reader.restoreTouchDelivery = () => { for (const restore of restores.reverse()) restore() }
  try {
    const scroll = reader.view.scrollView
    disable(scroll, "delaysContentTouches", "host.touch-delay", "immediate")
    disable(scroll, "canCancelContentTouches", "host.touch-cancel")
    try { disable(scroll?.pinchGestureRecognizer, "enabled", "host.pinch") }
    catch { inkLog(reader, "host.pinch unavailable") }
    disable(scroll, "scrollEnabled", "host.scroll")
  } catch { inkLog(reader, "host.gestures unavailable") }
}

function logEvents(reader: Reader, batch: any): void {
  if (!reader.debug || !Array.isArray(batch?.events)) return
  const frame = reader.view.frame
  if (frame && Number.isFinite(frame.width) && Number.isFinite(frame.height)) {
    const size = `${Math.round(frame.width)}x${Math.round(frame.height)}`
    if (size !== reader.debugFrame) { reader.debugFrame = size; inkLog(reader, `host.frame ${size}`) }
  }
  const safeValue = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && /^[a-z0-9_.:-]{1,48}$/i.test(value))
  if (Number.isSafeInteger(batch.dropped) && batch.dropped > 0) inkLog(reader, `trace.dropped=${batch.dropped}`)
  const events = batch.events.slice(0, 192).filter((row: any) => Array.isArray(row) && row.length >= 3 && row.length <= 12 &&
    Number.isSafeInteger(row[0]) && Number.isFinite(row[1]) && typeof row[2] === "string" &&
    /^(?:raw|route|engine|view|render|web)\.[a-z0-9-]{1,32}$/.test(row[2]) && row.every(safeValue))
  for (let i = 0; i < events.length; i += 8) {
    inkLog(reader, events.slice(i, i + 8).map((row: any[]) => `#${row[0]} +${row[1]}ms ${row.slice(2).join(" ")}`).join(" | "))
  }
}

function finish(reader: Reader): void {
  inkLog(reader, "host.close")
  if (readers.get(reader.view) === reader) readers.delete(reader.view)
  reader.next?.()
}

function startDiagnostics(reader: Reader): void {
  if (!reader.debug) return
  reader.timer = NSTimer.scheduledTimerWithTimeInterval(.55, true, () => {
    if (!reader.closing && !reader.publishing && loadMatcherSettings().debugModeEnabled) save(reader, false, undefined, true)
  })
}

function save(reader: Reader, flush = false, prepare?: number, diagnosticsOnly = false): void {
  if (prepare !== undefined) reader.pendingPrepare = prepare
  if (reader.saving) { reader.flushPending ||= flush; return }
  reader.saving = true
  reader.flushPending = false
  reader.checkpointPending = false
  const closing = reader.closing
  const preparing = closing ? undefined : reader.pendingPrepare
  const requireSnapshot = preparing !== undefined || (closing && reader.editing)
  reader.pendingPrepare = undefined
  const after = flush || preparing !== undefined ? reader.saved : reader.attempted
  const complete = (value: unknown, problem = "") => {
    reader.saving = false
    let error = problem
    let didWork = false
    let unchangedPublication = false
    try {
      if (value) {
        const serialized = String(value)
        if (serialized.length > 12000000) throw new Error("笔迹数据过大")
        const data = JSON.parse(serialized)
        if (data.token !== reader.token || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
            !Number.isSafeInteger(data.settingsRevision) || data.settingsRevision < 0) throw new Error("批注会话已过期")
        logEvents(reader, data.diagnostics)
        didWork = Boolean(data.answer || data.settings)
        let checkedDraft = false
        if (data.answer && data.revision > reader.saved) {
          reader.attempted = data.revision
          validateAnswer(data.answer)
          drafts.set(reader.group, data.answer)
          reader.draft = saveDraft(reader.group, data.answer, reader.draft)
          drafts.delete(reader.group)
          reader.saved = data.revision
          checkedDraft = true
        }
        if (data.settings && data.settingsRevision > reader.settingsRevision) {
          NSUserDefaults.standardUserDefaults().setObjectForKey(JSON.stringify(data.settings), settingsKey)
          reader.settingsRevision = data.settingsRevision
        }
        if (preparing !== undefined) {
          if (!reader.draft || data.revision !== reader.saved) throw new Error("最新笔迹未保存")
          if (!checkedDraft) {
            const stored = loadDraft(reader.group, reader.draft)
            if (stored?.digest !== reader.draft.digest) throw new Error("本机草稿已变化，请重试")
          }
          if (!data.revision && !allowsCardWrite()) {
            try { unchangedPublication = loadPublication(reader.group)?.draftDigest === reader.draft.digest }
            catch { /* Rebuild an unreadable preview from the verified draft. */ }
          }
          if (!unchangedPublication && reader.pendingPrepare === undefined) {
            reader.prepared = { id: preparing, revision: data.revision, digest: reader.draft.digest }
          }
        }
      } else if (requireSnapshot && !error) {
        error = "无法确认本次笔迹，请重试"
      }
    } catch (cause) { error = "保存草稿失败，" + String((cause as Error)?.message || cause); inkLog(reader, "host.snapshot-failed") }
    if (reader.closing) {
      if (!closing) { save(reader, true); return }
      if (error && reader.editing) {
        reader.closing = false
        reader.next = undefined
        setInkTouchDelivery(reader, true)
        startPencilHover(reader)
        startDiagnostics(reader)
        reply(reader, "cardLinkAnswerInkResult", reader.saved, error)
        showHUD(error, 3)
        return
      }
      finish(reader)
      if (error) showHUD(error, 3)
      return
    }
    if (preparing !== undefined && unchangedPublication) reply(reader, "cardLinkAnswerInkPrepared", preparing, "", true)
    else if (preparing !== undefined) replyPrepared(reader, preparing, error)
    else if (didWork || error) reply(reader, "cardLinkAnswerInkResult", reader.saved, error)
    if (reader.flushPending && !reader.publishing) save(reader, true)
    else if (reader.checkpointPending && reader.editing && !reader.publishing) save(reader)
  }
  evaluateTimed(reader, "window.cardLinkAnswerInkSnapshot && window.cardLinkAnswerInkSnapshot(" +
    [flush, after, reader.settingsRevision, requireSnapshot, diagnosticsOnly && !requireSnapshot].join(",") + ")", complete)
}

function nativeCard(reader: Reader): any {
  const note = MN.db.getNoteById(reader.noteId)
  if (!note || String(note.notebookId) !== reader.notebookId) throw new Error("未找到原答案卡片")
  return note
}

function ownedComments(note: any, requireList = false) {
  if (requireList && note?.comments == null) throw new Error("无法核对原答案卡的评论列表")
  return Array.from<any>(note?.comments || []).flatMap(comment => {
    const identity = answerInkCommentIdentity(comment)
    if (!identity) return []
    const html = String(comment.html || "")
    const image = html.match(/\bsrc=["'](data:image\/png;base64,[A-Za-z0-9+/]+={0,2})["']/)?.[1]
    return [{ ...identity, html, image }]
  }).reverse()
}

function loadPublishedPreview(reader: Reader): void {
  let local: Publication | undefined, image: string | undefined, error = ""
  try { local = loadPublication(reader.group) }
  catch { error = "无法读取已保存的批注发布记录" }
  try {
    image = local?.image ?? ownedComments(nativeCard(reader)).find(comment => pngDimensions(comment.image))?.image
  } catch { /* The draft remains available even if the original card was removed. */ }
  if (local && reader.draft && local.sequence > reader.draft.sequence) {
    error ||= "已恢复上一份可读草稿，批注图片对应更新版本"
  }
  reply(reader, "cardLinkAnswerInkPreview", image || "", error || (image ? publicationNotice(local) : "无法读取批注图片"))
}

function publicationNotice(record?: Publication): string {
  if (!record) return ""
  if (record.state === "local") return "已保存到本机"
  if (record.state === "verified") return "本机已保存，原卡评论显示与折叠待核实"
  if (record.state === "failed") return "本机已保存，原卡写入失败，可重试"
  return record.outstanding ? "本机已保存，原卡写入结果待确认" : "本机已保存，原卡已有批注，替换待验证"
}

function writeCardImage(reader: Reader, draft: Draft, payload: { image: string; width: number; height: number }): string {
  const note = nativeCard(reader)
  const comments = ownedComments(note, true)
  const prior = loadPublication(reader.group)
  const imageHash = sha256Hex(payload.image)
  let outstanding = prior?.outstanding
  if (outstanding && comments.some(comment => comment.imageHash === outstanding &&
        pngDimensions(comment.image) && sha256Hex(comment.image!) === outstanding)) outstanding = undefined
  const receipt: Publication = {
    version: 1, sequence: draft.sequence, draftDigest: draft.digest,
    ...payload, imageHash, state: "pending", outstanding
  }
  const matches = (items: ReturnType<typeof ownedComments>) => items.some(comment =>
    comment.imageHash === imageHash && comment.image === payload.image && /^\s*<img\b/i.test(comment.html) &&
    isAnswerInkPng({ ...payload, image: comment.image }))
  if (matches(comments)) {
    const verified = { ...receipt, state: "verified", outstanding: undefined } as const
    savePublication(reader.group, verified)
    return publicationNotice(verified)
  }
  if (comments.length || outstanding) {
    savePublication(reader.group, receipt)
    return publicationNotice(receipt)
  }

  // Persist the pending write before entering the host so a restart can query
  // the card without replaying an append whose outcome is still unknown.
  const submitted = { ...receipt, outstanding: imageHash }
  savePublication(reader.group, submitted)
  let invoked = false
  try {
    const marker = answerInkCommentMarker(reader.group, imageHash)
    UndoManager.sharedInstance().undoGrouping("保存答案批注", reader.notebookId, () => {
      invoked = true
      note.appendHtmlComment('<img id="' + marker + '" alt="答案批注" width="' + payload.width + '" height="' + payload.height +
        '" style="display:block;max-width:100%;height:auto" src="' + payload.image + '">',
        "答案批注", { width: payload.width, height: payload.height }, marker)
    })
    if (invoked) MN.app.refreshAfterDBChanged(reader.notebookId)
  } catch {
    inkLog(reader, "host.publish-write-interrupted")
  }

  if (matches(ownedComments(nativeCard(reader), true))) {
    const verified = { ...receipt, state: "verified" } as const
    savePublication(reader.group, verified)
    return publicationNotice(verified)
  }
  if (!invoked) {
    savePublication(reader.group, { ...receipt, state: "failed" })
    throw new Error("宿主未执行评论写入，笔迹已保存，可重试")
  }
  return publicationNotice(submitted)
}

function publish(reader: Reader, id: number): void {
  const prepared = reader.prepared
  if (!reader.editing || reader.publishing || reader.closing || prepared?.id !== id) return
  reader.prepared = undefined
  reader.publishing = true
  inkLog(reader, "host.publish-start")
  evaluateTimed(reader, "window.cardLinkAnswerInkImage && window.cardLinkAnswerInkImage(" + id + ")", (value, problem) => {
    let error = "", notice = ""
    try {
      if (problem) throw new Error(problem)
      const serialized = String(value || "null")
      if (serialized.length > 4_001_024) throw new Error("批注图片数据过大")
      const payload = JSON.parse(serialized)
      const draft = loadDraft(reader.group, reader.draft)
      if (!draft || draft.digest !== prepared.digest || payload?.revision !== prepared.revision ||
          !isAnswerInkPng(payload) || payload.inkPixels !== (draft.answer.strokes.length > 0)) {
        throw new Error("批注图片无效或与草稿不同步")
      }
      const image = { image: payload.image, width: payload.width, height: payload.height }
      if (allowsCardWrite()) {
        notice = writeCardImage(reader, draft, image)
      } else {
        const record: Publication = {
          version: 1, sequence: draft.sequence, draftDigest: draft.digest,
          ...image, imageHash: sha256Hex(image.image), state: "local",
          outstanding: loadPublication(reader.group)?.outstanding
        }
        savePublication(reader.group, record)
        notice = publicationNotice(record)
      }
      inkLog(reader, "host.publish-saved-local")
    } catch (cause) {
      error = String((cause as Error)?.message || cause)
      inkLog(reader, "host.publish-failed")
    } finally {
      reader.publishing = false
    }
    if (reader.closing) {
      if (error) showHUD(error, 3)
      save(reader, true)
    } else reply(reader, "cardLinkAnswerInkPublishResult", error, reader.group, notice, id)
  })
}

export function answerInkDocument(owner: any, html: string): string {
  if (!owner.answerCardAnnotationKey || typeof __ANSWER_INK_SCRIPT__ !== "string") return html
  const view = owner.answerCardWebView, key = owner.answerCardAnnotationKey as string
  const [, , notebookId, noteId] = JSON.parse(key)
  const group = sha256Hex(JSON.stringify([notebookId, noteId]))
  const answer = drafts.get(group)
  let draft: Draft | undefined, legacy: Draft | undefined
  let error = ""
  try {
    draft = loadDraft(group)
    if (!draft) legacy = loadDraft(sha256Hex(key))
  }
  catch { error = "无法读取已保存的可编辑草稿" }
  const initialRevision = answer || legacy ? -1 : 0
  const reader: Reader = { owner, view, group, noteId, notebookId, draft, token: String(++generation),
    saved: initialRevision, attempted: initialRevision, settingsRevision: 0, saving: false, publishing: false,
    closing: false, editing: false, debug: loadMatcherSettings().debugModeEnabled }
  if (!Delegate) Delegate = JSB.defineClass("CardLinkAnswerInkDelegate : UIViewController <UIWebViewDelegate>", {
    onAnswerInkPencilHover,
    webViewShouldStartLoadWithRequestNavigationType(web: any, request: any) {
      const url = String(request.URL().absoluteString())
      if (!url.startsWith(prefix)) return true
      const current = readers.get(web)
      const [path, token] = url.slice(prefix.length).split("?")
      const command = path.replace(/\/$/, "")
      if (!current || current.closing || token !== current.token) return false
      const hit = /^hit\/([1-9][0-9]{0,2})$/.exec(command)
      if (hit) {
        const width = Number(hit[1])
        if (width <= ANSWER_INK_MAX_WIDTH) current.owner.answerInkHitAreaChanged?.(width)
        return false
      }
      if (command === "start" && !current.editing) {
        current.editing = true
        try {
          const scroll = current.view.scrollView
          if (Math.abs(Number(scroll?.zoomScale) - 1) > .01) scroll.setZoomScaleAnimated?.(1, false)
        } catch { inkLog(current, "host.zoom-reset unavailable") }
        setInkTouchDelivery(current, true)
        startPencilHover(current)
        inkLog(current, "host.edit 1")
      }
      if (command === "end") {
        current.editing = false
        stopPencilHover(current)
        setInkTouchDelivery(current, false)
        inkLog(current, "host.edit 0")
        save(current, true)
      }
      if (command === "checkpoint" && current.editing && !current.publishing) {
        if (current.saving) current.checkpointPending = true
        else save(current)
      }
      if (command === "preview" && !current.editing) loadPublishedPreview(current)
      const saveRequest = /^(prepare|publish)\/([1-9][0-9]{0,8})$/.exec(command)
      if (saveRequest && current.editing) {
        const id = Number(saveRequest[2])
        if (saveRequest[1] === "prepare" && !current.publishing) {
          current.prepared = undefined
          save(current, true, id)
        } else if (saveRequest[1] === "publish") publish(current, id)
      }
      return false
    }
  }, {})
  delegate ||= Delegate.new()
  readers.set(view, reader)
  view.delegate = delegate
  inkLog(reader, "host.open UIWebView")
  startDiagnostics(reader)
  const config = JSON.stringify({ token: reader.token, answer: answer ?? draft?.answer ?? legacy?.answer,
    settings: toolSettings() || draft?.settings || legacy?.settings, error,
    toolbarFrame: owner.answerInkToolbarFrame, group,
    ...(reader.debug ? { debug: true } : {}) }).replace(/</g, "\\u003c")
  let preview = ""
  try {
    if (hasAnswerInkPublication(group) || Array.from<any>(nativeCard(reader).comments ?? []).some(answerInkCommentIdentity)) {
      preview = '<details class="answer-ink-saved" data-answer-ink-saved="' + group +
        '"><summary>答案批注</summary><img hidden alt="答案批注"></details>'
    }
  } catch { /* Keep the original answer readable. */ }
  return appendToHtmlBody(html, preview + '<script>window.cardLinkAnswerInkConfig=' + config + ';' + __ANSWER_INK_SCRIPT__ + '</script>')
}

export function closeAnswerInk(owner: any, next?: () => void): void {
  const reader = readers.get(owner.answerCardWebView)
  if (!reader) { next?.(); return }
  reader.next = next
  if (reader.closing) return
  reader.closing = true
  stopPencilHover(reader)
  setInkTouchDelivery(reader, false)
  reader.timer?.invalidate?.()
  if (!reader.editing && !reader.saving && !reader.publishing) finish(reader)
  else if (!reader.publishing) save(reader, true)
}
