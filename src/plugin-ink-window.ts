import { createWindowSurface } from "./window-opacity"
import { MN, isfileExists, readJSON, select } from 'marginnote'
import { cardLinkDocumentPath, ensureStorageDirectory } from './storage-paths'
import { sha256Hex } from './content-fingerprint'
import { renderCardHtml } from './card-html'
import { pluginInkComment, pluginInkMarker, validatePluginInkRecord, type PluginInkRecord } from './plugin-ink-record'
import { notifyWorkbenchDataChanged } from './workbench-notification'
import { pluginInkFrame } from './plugin-ink-layout'

declare const __PLUGIN_INK_SCRIPT__: string

interface Target { noteid: string; topicid: string; recordId: string; reviewToken: string; advance: string; newAttempt?: boolean; commentId?: string }
interface Session { owner: any; target: Target; view: any; delegate: any; container: any; busy: boolean; config: any; event?: any; attempt?: PluginInkRecord }
const sessions = new WeakMap<object, Session>()
const windowFrames = new WeakMap<object, ReturnType<typeof pluginInkFrame>>()
let Delegate: any
const root = (target: Target) => cardLinkDocumentPath(`plugin-ink/${sha256Hex(target.topicid + ':' + target.noteid)}`)
const pathFor = (target: Target, id: string) => `${root(target)}/${id}.json`

function writeRecord(target: Target, record: PluginInkRecord): void {
  const directory = root(target)
  if (!ensureStorageDirectory(directory)) throw new Error('无法建立批注存储目录')
  const path = pathFor(target, record.id), json = JSON.stringify(record)
  const data = NSData.dataWithStringEncoding(json, 4)
  if (!data?.writeToFileAtomically(path, true)) throw new Error('笔画保存失败，请重试')
}

function history(target: Target): PluginInkRecord[] {
  const directory = root(target)
  if (!isfileExists(directory)) return []
  const values: PluginInkRecord[] = []
  for (const file of Array.from(NSFileManager.defaultManager().contentsOfDirectoryAtPath(directory) || []) as string[]) {
    if (!/^[a-z0-9-]+\.json$/.test(file)) continue
    try { values.push(validatePluginInkRecord(readJSON(`${directory}/${file}`), target.noteid, target.topicid)) } catch { /* Preserve unreadable records. */ }
  }
  return values.sort((a, b) => b.createdAt - a.createdAt)
}

async function comments(session: Session, operation = 'ink-read', marker?: string): Promise<any> {
  return (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(session.owner, {
    operation, noteid: session.target.noteid, marker, reviewToken: session.target.reviewToken
  })
}

async function save(session: Session, payload: any): Promise<void> {
  const { target } = session
  if (session.attempt && (session.attempt.image !== payload.image ||
      JSON.stringify(JSON.parse(session.attempt.strokes).strokes) !== JSON.stringify(JSON.parse(payload.strokes).strokes))) {
    session.config.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    session.config.createdAt = Date.now()
  }
  const record = validatePluginInkRecord({ ...payload, version: 1, id: session.config.id,
    noteId: target.noteid, notebookId: target.topicid, createdAt: session.config.createdAt }, target.noteid, target.topicid)
  // Keep the editable source before writing to the card. A failed fold/save can
  // be retried with the same marker without appending a duplicate comment.
  writeRecord(target, record)
  session.attempt = record
  const marker = pluginInkMarker(record.id)
  let result = await comments(session)
  if (!(result.comments || []).some((c: any) => c.text === marker)) {
    const note = MN.db.getNoteById(target.noteid)
    if (!note) throw new Error('原题卡片已不存在，笔画已保留在本机')
    let executed = false
    UndoManager.sharedInstance().undoGrouping('保存插件内批注', target.topicid, () => {
      executed = true
      note.appendHtmlComment(pluginInkComment(record), marker, { width: record.width, height: record.height }, `cardlink-ink-${record.id}`)
    })
    if (!executed) throw new Error('宿主未执行图片评论写入，笔画已保留')
    MN.app.refreshAfterDBChanged(target.topicid)
  }
  result = await comments(session, 'ink-fold', marker)
  const item = (result.comments || []).find((c: any) => c.text === marker)
  if (result.persisted !== true || !item?.collapsed) throw new Error('图片评论的写入或折叠尚未确认，请重试；笔画已保留')
  record.saved = true
  record.commentId = item.commentId || undefined
  writeRecord(target, record)
  notifyWorkbenchDataChanged(session.owner)
}

function finish(session: Session, saved: boolean, action = 'close'): void {
  session.container.removeFromSuperview()
  session.event = { noteid: session.target.noteid, reviewToken: session.target.reviewToken, saved, action, commentId: saved ? session.attempt?.commentId : undefined }
  session.owner.cardLinkReviewAnnotationClosed?.(session.event)
}

function reply(session: Session, error: unknown): void {
  session.view.evaluateJavaScript(`window.cardlinkInkResult(${JSON.stringify(String((error as any)?.message || error))})`, null)
}

async function command(session: Session, name: string, argument = ''): Promise<void> {
  if (sessions.get(session.owner) !== session || session.event || session.owner.cardLinkReviewMode?.annotationToken !== session.target.reviewToken) return
  if (session.busy) return
  if (name === 'layout') {
    try {
      const requested = JSON.parse(decodeURIComponent(argument))
      const bounds = session.container.superview.bounds
      const frame = pluginInkFrame(bounds, requested)
      session.container.frame = frame
      windowFrames.set(session.owner, frame)
      session.view.evaluateJavaScript(`window.cardlinkInkLayout(${JSON.stringify({ frame, bounds: { width: bounds.width, height: bounds.height } })})`, null)
    } catch { /* Ignore malformed layout requests without affecting the editor. */ }
    return
  }
  if (name === 'ready') {
    session.view.evaluateJavaScript(`window.cardlinkInkOpen(${JSON.stringify(session.config).replace(/</g, '\\u003c')})`, null)
    return
  }
  if (name === 'cancel') { finish(session, false); return }
  if (name !== 'save') return
  try { await completePluginInkWindow(session.owner, true) } catch { /* result is shown in the editor */ }
}

/** The toolbar uses the same export/save/fold transaction as the canvas button. */
export async function completePluginInkWindow(owner: any, prepared = false): Promise<void> {
  const session = sessions.get(owner)
  if (!session || session.event) return
  if (session.busy) throw new Error('批注正在保存，请稍候')
  session.busy = true
  try {
    const value = await new Promise<any>(resolve => session.view.evaluateJavaScript(prepared
      ? 'JSON.stringify(window.cardlinkInkPayload)'
      : 'JSON.stringify(window.cardlinkInkPreparePayload())', resolve))
    if (!value) throw new Error('未取得批注数据')
    await save(session, JSON.parse(String(value)))
    finish(session, true, session.target.advance)
  } catch (error) { reply(session, error); throw error }
  finally { session.busy = false }
}

export async function openPluginInkWindow(owner: any, target: Target): Promise<{ editorOpened: boolean }> {
  const previous = sessions.get(owner)
  if (previous && !previous.event) throw new Error('请先保存或关闭插件内批注窗口')
  const note = MN.db.getNoteById(target.noteid)
  if (!note) throw new Error('原题卡片已不存在')
  // Detect missing host folding support before presenting a sheet that cannot
  // meet this mode's save contract.
  await (globalThis as any).__MNAM_SCENE_WORKBENCH_GLOBAL__.openReviewAnnotation(owner, { operation: 'ink-read', noteid: target.noteid, reviewToken: target.reviewToken })
  const records = history(target)
  let saved: PluginInkRecord | undefined
  if (target.commentId) saved = records.find(record => record.commentId === target.commentId)
  if (!target.newAttempt && !saved && records.length) {
    const choice = await select(['新建批注', ...records.map(r => `${r.saved ? '编辑' : '恢复未完成'} · ${new Date(r.createdAt).toLocaleString()}`)], '插件内批注', '编辑后保存为新版本，保留之前的图片评论', true)
    if (choice.index < 0) {
      owner.cardLinkReviewAnnotationClosed?.({ noteid: target.noteid, reviewToken: target.reviewToken, saved: false, action: 'close' })
      return { editorOpened: true }
    }
    if (choice.index > 0) saved = records[choice.index - 1]
  }
  if (owner.cardLinkReviewMode?.annotationToken !== target.reviewToken) return { editorOpened: false }
  const media = (hash: string) => { try { return String(MN.db.getMediaByHash(hash)?.base64Encoding() || '') || undefined } catch { return undefined } }
  // Never bake previous plugin images or child answers into a new question sheet.
  const copy = { noteId: note.noteId, noteTitle: note.noteTitle, excerptText: note.excerptText,
    excerptTextMarkdown: (note as any).excerptTextMarkdown, excerptPic: note.excerptPic,
    comments: Array.from(note.comments || []).filter((c: any) => !String(c.text || '').startsWith('CardLink 插件批注 ')) }
  const html = renderCardHtml(copy, '复习作答', id => MN.db.getNoteById(id), media, media, false, false)
    .replace(/<script id="cardlink-preview-runtime">[\s\S]*?<\/script>/, '')
  const host = MN.studyController.view, bounds = host.bounds
  const frame = pluginInkFrame(bounds, windowFrames.get(owner))
  const container = createWindowSurface(frame)
  container.autoresizingMask = (1 << 1) | (1 << 4)
  container.backgroundColor = UIColor.whiteColor()
  container.layer.cornerRadius = 14
  container.layer.masksToBounds = true
  ;(container.layer as any).zPosition = 90000
  const view = new UIWebView({ x: 0, y: 0, width: container.frame.width, height: container.frame.height })
  view.autoresizingMask = (1 << 1) | (1 << 4)
  view.scalesPageToFit = false
  // The 842 surface pans/zooms its own paper. The native WebView scroller
  // must not delay or cancel a Pencil contact to begin scrolling the page.
  if (view.scrollView) {
    view.scrollView.scrollEnabled = false
    view.scrollView.bounces = false
    view.scrollView.delaysContentTouches = false
    view.scrollView.canCancelContentTouches = false
  }
  if (!Delegate) Delegate = JSB.defineClass('CardLinkInkDelegate : UIViewController <UIWebViewDelegate>', {
    webViewShouldStartLoadWithRequestNavigationType(web: any, request: any) {
      const url = String(request.URL().absoluteString())
      if (!url.startsWith('cardlink-ink://')) return url === 'about:blank' || url.startsWith('about:srcdoc')
      const session = Array.from(activeSessions).find(s => s.view === web)
      const [name, argument = ''] = url.slice('cardlink-ink://'.length).split('?')
      if (session) void command(session, name.split(/[\/#]/)[0], argument)
      return false
    }
  }, {})
  const delegate = Delegate.new()
  const createdAt = Date.now()
  const session: Session = { owner, target, view, container, delegate, busy: false, attempt: saved?.saved ? undefined : saved, config: {
    id: saved && !saved.saved ? saved.id : `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: saved && !saved.saved ? saved.createdAt : createdAt,
    title: note.noteTitle || '复习作答', advance: target.advance, html, saved,
    window: { frame, bounds: { width: bounds.width, height: bounds.height } }
  } }
  if (previous) activeSessions.delete(previous)
  activeSessions.add(session)
  sessions.set(owner, session)
  view.delegate = delegate
  container.addSubview(view)
  host.addSubview(container)
  view.loadHTMLStringBaseURL(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"></head><body><script>${__PLUGIN_INK_SCRIPT__}</script></body></html>`, null)
  return { editorOpened: true }
}

const activeSessions = new Set<Session>()
export function pluginInkStatus(owner: any): any {
  const session = sessions.get(owner)
  return session?.event ? { state: 'closed', event: session.event } : { state: 'unknown' }
}
export function disposePluginInkWindow(owner: any): void {
  const session = sessions.get(owner)
  if (session) { session.container.removeFromSuperview(); activeSessions.delete(session); sessions.delete(owner) }
}

export function setPluginInkWindowVisible(owner: any, visible: boolean): void {
  const session = sessions.get(owner)
  if (session && !session.event) session.container.hidden = !visible
}
