import { getLocalDataByKey, setLocalDataByKey, MN, NodeNote, showHUD, select } from "marginnote"
import { setCardToolbarEnabled } from "./card-toolbar-state"

// Adapted from the supplied QuestionClipper v0.4.1-beta.1 source.
export type ClipStage = "title" | "question" | "answer"
const SETTINGS_KEY = "cardlink.question-clipper.v1"
const stages: ClipStage[] = ["title", "question", "answer"]
const commands = ["ToolTextExcerpt", "ToolRectCut", "ExcerptToolSketch",
  ...Array.from({ length: 16 }, (_, i) => `ExcerptToolCustom${i}`)]
type TitleMode = "original" | "prefix" | "mother" | "number"
const TITLE_MODES: TitleMode[] = ["original", "prefix", "mother", "number"]
const TITLE_LABELS = ["原始标题", "统一前缀＋标题", "母卡标题＋标题", "母卡内自动题号"]
const NUMBER_KEY = "cardlink.question-clipper.numbers.v1"
interface ClipSettings { excerptTitle: boolean; excerptAnswer: boolean; tools: Partial<Record<ClipStage, string>>; titleMode: TitleMode; titlePrefix: string }
interface ClipSession {
  owner: any
  notebookId: string; window: any; running: boolean; started: boolean; stage: ClipStage
  title: string; questionId: string; tempTitleId: string; motherId: string; motherTitle: string
  manualTitle: boolean
  manualNumber?: number
  completed: number; generation: number; seen: Set<string>; issue: string; previousContinue?: boolean
  settings: ClipSettings; changed: () => void
}
function session(owner: any = self): ClipSession | undefined { return owner.questionClipper }
function notifyClipperStateChanged(owner: any): void {
  try {
    owner.webController?.webView?.evaluateJavaScript(
      "typeof window.__onNativeBindingsChanged==='function'&&window.__onNativeBindingsChanged()",
      () => undefined
    )
  } catch { /* The panel also fetches current settings when it is shown again. */ }
}
const clean = (value: unknown) => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\*\*/g, "").replace(/\s+/g, " ").trim()
function app(): any { return Application.sharedInstance() }
function query(command: string, win = session()?.window ?? self.window): any {
  try { return app().queryCommandWithKeyFlagsInWindow(command, 0, win) } catch { return null }
}
function run(command: string, win: any): void {
  if (query(command, win)?.disabled === true) return
  app().processCommandWithKeyFlagsInWindow(command, 0, win)
}
function commit(notebookId: string): void {
  const db = MN.db as any
  db.setNotebookSyncDirty(notebookId)
  db.savedb()
  app().refreshAfterDBChanged(notebookId)
}
export function clipperSettings(): ClipSettings {
  const raw = getLocalDataByKey(SETTINGS_KEY) as any
  const saved = typeof raw === "string" ? JSON.parse(raw) : raw
  const tools: ClipSettings["tools"] = {}
  for (const stage of stages) if (commands.includes(saved?.tools?.[stage])) tools[stage] = saved.tools[stage]
  return { excerptAnswer: saved?.excerptAnswer !== false && saved?.excerptAnswer !== 0, excerptTitle: saved?.excerptTitle !== false && saved?.excerptTitle !== 0, tools,
    titleMode: TITLE_MODES.includes(saved?.titleMode) ? saved.titleMode : "original", titlePrefix: clean(saved?.titlePrefix) }
}
export function saveClipperTitleFormat(mode: string, prefix: string, owner: any = self): void {
  if (!TITLE_MODES.includes(mode as TitleMode)) throw new Error("无效的标题格式")
  if (session(owner)?.started) throw new Error("请先结束当前摘题，再修改标题格式")
  const settings = { ...clipperSettings(), titleMode: mode as TitleMode, titlePrefix: clean(prefix) }
  if (mode === "prefix" && !settings.titlePrefix) throw new Error("统一前缀不能为空")
  setLocalDataByKey(JSON.stringify(settings), SETTINGS_KEY)
  if (session(owner)) { session(owner)!.settings = settings; session(owner)!.changed() }
}
export async function configureClipperTitleFormat(owner: any = self): Promise<void> {
  if (session(owner)?.started) throw new Error("请先结束当前摘题，再修改标题格式")
  const settings = clipperSettings()
  const choice = await select(TITLE_LABELS, "摘录标题格式", "前缀与标题用「 · 」连接；自动题号按母卡分别连续编号。", true)
  if (choice.index < 0) return
  let prefix = settings.titlePrefix
  if (TITLE_MODES[choice.index] === "prefix") {
    const input = await MNUtil.input("统一标题前缀", "例如：第一章，生成「第一章 · 摘录标题」", ["取消", "保存"], { default: prefix })
    if (!input || input.button !== 1) return
    prefix = input.input
  }
  saveClipperTitleFormat(TITLE_MODES[choice.index], prefix, owner)
}
function rememberNumber(s: ClipSession, number: number): void {
  if (!s.motherId) return
  const raw = getLocalDataByKey(NUMBER_KEY) as any
  const counters = typeof raw === "string" ? JSON.parse(raw) : raw || {}
  const key = JSON.stringify([s.notebookId, s.motherId])
  counters[key] = number
  counters[key + "::next"] = number + 1
  setLocalDataByKey(JSON.stringify(counters), NUMBER_KEY)
}
function titleNumber(title: string): number | undefined {
  const match = title.match(/(?:^| · )第([0-9]+)题(?:$| · )/)
  return match ? Number(match[1]) : undefined
}
function questionTitle(s: ClipSession, note: any): { title: string; recordNumber?: () => void } {
  const base = s.title || clean(note.noteTitle || note.excerptText) || "未命名题目"
  if (s.manualTitle || s.settings.titleMode === "original") return { title: s.title || clean(note.noteTitle),
    recordNumber: s.manualNumber ? () => rememberNumber(s, s.manualNumber!) : undefined }
  if (s.settings.titleMode === "prefix") return { title: `${s.settings.titlePrefix} · ${base}` }
  const mother = s.motherId && MN.db.getNoteById(s.motherId)
  if (!mother) throw new Error("当前标题格式需要母卡，请先绑定母卡")
  if (s.settings.titleMode === "mother") return { title: `${clean(mother.noteTitle || mother.excerptText) || s.motherTitle} · ${base}` }
  const raw = getLocalDataByKey(NUMBER_KEY) as any
  const counters: Record<string, number> = typeof raw === "string" ? JSON.parse(raw) : raw || {}
  const key = JSON.stringify([s.notebookId, s.motherId])
  const largest = Array.from((mother as any).childNotes || []).reduce((max: number, child: any) => {
    return Math.max(max, titleNumber(clean(child.noteTitle)) || 0)
  }, Number(counters[key]) || 0)
  const next = counters[key + "::next"]
  const number = Number.isSafeInteger(next) && next > 0 ? next : largest + 1
  return { title: `第${number}题${s.title ? ` · ${s.title}` : ""}`, recordNumber: () => rememberNumber(s, number) }
}
export function clipToolLabel(command?: string): string {
  if (!command) return "未绑定"
  if (command === "ToolTextExcerpt") return "文本"
  if (command === "ToolRectCut") return "矩形"
  if (command === "ExcerptToolSketch") return "手绘"
  return command.replace("ExcerptToolCustom", "自定义 ")
}
export function clipperSnapshot(owner: any = self) {
  const s = session(owner), settings = clipperSettings()
  return { ...settings, mode: !!s, running: s?.running ?? false, started: s?.started ?? false,
    stage: s?.stage ?? (settings.excerptTitle ? "title" : "question"), title: s?.title ?? "",
    motherTitle: s?.motherTitle ?? "", motherId: s?.motherId ?? "", completed: s?.completed ?? 0,
    issue: s?.issue ?? "", toolLabels: Object.fromEntries(stages.map(stage => [stage, clipToolLabel(settings.tools[stage])])) }
}
export function saveClipperSetting(excerptTitle: boolean, owner: any = self): void {
  const settings = { ...clipperSettings(), excerptTitle }
  setLocalDataByKey(JSON.stringify(settings), SETTINGS_KEY)
  const s = session(owner)
  if (s) {
    s.settings = settings; s.generation++
    if (!s.questionId) {
      s.stage = excerptTitle ? s.title ? "question" : "title" : "question"
      if (!excerptTitle && !s.manualTitle) { s.title = ""; s.tempTitleId = "" }
    }
    s.issue = ""; s.changed()
    if (s.running) switchTool(s)
  }
}
function completeClipperQuestion(s: ClipSession): void {
  s.completed++; s.title = ""; s.manualTitle = false; s.manualNumber = undefined; s.questionId = ""
  s.stage = s.settings.excerptTitle ? "title" : "question"
}
export function saveClipperAnswerSetting(excerptAnswer: boolean, owner: any = self): void {
  const settings = { ...clipperSettings(), excerptAnswer }
  setLocalDataByKey(JSON.stringify(settings), SETTINGS_KEY)
  const s = session(owner)
  if (!s) return
  s.settings = settings; s.generation++
  if (!excerptAnswer && s.stage === "answer") completeClipperQuestion(s)
  s.issue = ""; s.changed()
  if (s.running) switchTool(s)
}
export function recordClipperTool(slot: string, owner: any = self): void {
  if (!stages.includes(slot as ClipStage)) throw new Error("无效的工具位置")
  if (session(owner)?.started) throw new Error("请先结束当前摘题，再绑定工具")
  const checked = commands.filter(command => { const st = query(command, owner.window); return st?.checked === true && st.disabled !== true })
  const custom = checked.filter(command => command.startsWith("ExcerptToolCustom"))
  const bases = checked.filter(command => !command.startsWith("ExcerptToolCustom"))
  const command = custom.length === 1 ? custom[0]
    : slot === "title" && checked.includes("ToolTextExcerpt") ? "ToolTextExcerpt"
      : slot !== "title" && !custom.length && checked.includes("ToolRectCut") ? "ToolRectCut"
        : !custom.length && bases.length === 1 ? bases[0] : undefined
  if (!command) throw new Error(checked.length ? "当前有多个工具选中，无法识别；请重新选择工具后记录" : "请先在 MarginNote 顶部选择摘录工具，再点击记录")
  const settings = clipperSettings()
  settings.tools[slot as ClipStage] = command
  setLocalDataByKey(JSON.stringify(settings), SETTINGS_KEY)
  if (session(owner)) session(owner)!.settings = settings
  showHUD(`已绑定${{ title: "标题", question: "题目", answer: "答案" }[slot]}工具：${clipToolLabel(command)}`, 2)
}
export function clipperModeActive(owner: any = self): boolean { return !!session(owner) }
export function enterClipperMode(changed: () => void, owner: any = self): void {
  if (session(owner)) { session(owner)!.changed = changed; return }
  const notebookId = String(MN.currnetNotebookId ?? "")
  const window = owner.window
  if (!notebookId || !app().studyController(window)?.readerController?.currentDocumentController) {
    throw new Error("请先打开学习集中的文档，再开启摘题模式")
  }
  const settings = clipperSettings()
  owner.questionClipper = { owner, notebookId, window, running: false, started: false,
    stage: settings.excerptTitle ? "title" : "question", title: "", manualTitle: false, questionId: "", tempTitleId: "",
    motherId: "", motherTitle: "", completed: 0, generation: 0, seen: new Set(), issue: "", settings, changed } satisfies ClipSession
  setCardToolbarEnabled(false, owner)
  notifyClipperStateChanged(owner)
}
export function exitClipperMode(owner: any = self): void {
  const s = session(owner)
  if (!s) return
  s.running = false; s.generation++
  if (s.previousContinue !== undefined) {
    try { if (query("ContinueExcerpt", s.window)?.checked !== s.previousContinue) run("ContinueExcerpt", s.window) } catch { /* host is closing */ }
  }
  owner.questionClipper = undefined
  setCardToolbarEnabled(true, owner)
  notifyClipperStateChanged(owner)
}
function switchTool(s: ClipSession, attempt = 0): void {
  const generation = s.generation, stage = s.stage
  const command = s.settings.tools[stage] ?? (stage === "title" ? "ToolTextExcerpt" : s.settings.tools.question ?? "ToolRectCut")
  const live = () => session(s.owner) === s && s.running && s.generation === generation && s.stage === stage
  NSTimer.scheduledTimerWithTimeInterval([.18, .32, .48, .7, .95][attempt], false, () => {
    if (!live()) return
    try {
      if (query("ContinueExcerpt", s.window)?.checked) run("ContinueExcerpt", s.window)
      if (query(command, s.window)?.checked) return
      run(command, s.window)
    } catch { /* verify and retry via the command URL, as in the reference */ }
    NSTimer.scheduledTimerWithTimeInterval(.16, false, () => {
      if (!live() || query(command, s.window)?.checked) return
      try { app().openURL(NSURL.URLWithString(`marginnote4app://command/${command}`)) } catch { /* report after retries */ }
      NSTimer.scheduledTimerWithTimeInterval(.22, false, () => {
        if (!live() || query(command, s.window)?.checked) return
        if (attempt < 4) return switchTool(s, attempt + 1)
        s.issue = "请手动选择当前步骤的摘录工具"
        s.changed(); showHUD(s.issue, 3)
      })
    })
  })
}
export function toggleClipperRunning(owner: any = self): void {
  const s = session(owner)
  if (!s) return
  if (!s.started) s.previousContinue = query("ContinueExcerpt", s.window)?.checked === true
  s.started = true; s.running = !s.running; s.generation++; s.issue = ""
  if (s.running) switchTool(s)
  s.changed()
  notifyClipperStateChanged(owner)
}
export function bindClipperMother(): void {
  const s = session()
  if (!s) return
  const note = NodeNote.getSelectedNodes()[0]?.note
  if (!note?.noteId) { unbindClipperMother(); return }
  if (String(note.notebookId) !== s.notebookId) return showHUD("请选择当前学习集中的母卡", 3)
  if ([s.questionId, s.tempTitleId].includes(String(note.noteId))) return showHUD("请选取当前摘录卡片以外的母卡", 3)
  s.motherId = String(note.noteId); s.motherTitle = clean(note.noteTitle || note.excerptText) || "未命名母卡"
  s.changed()
}
export function unbindClipperMother(): void {
  const s = session()
  if (s) { s.motherId = ""; s.motherTitle = ""; s.changed() }
}
/** QuestionClipper qcResetFlow: discard flow references, never delete existing cards. */
export function resetClipperQuestion(owner: any = self): void {
  const s = session(owner)
  if (!s?.started) { showHUD("请先开始摘题", 2); return }
  s.generation++
  s.title = ""; s.manualTitle = false; s.manualNumber = undefined; s.questionId = ""; s.tempTitleId = ""; s.issue = ""
  s.stage = s.settings.excerptTitle ? "title" : "question"
  if (query("ContinueExcerpt", s.window)?.checked) run("ContinueExcerpt", s.window)
  if (s.running) switchTool(s)
  s.changed()
  showHUD("已重置当前摘题流程；已有卡片不会删除", 2)
}
export async function editClipperQuestionTitle(owner: any = self): Promise<void> {
  const s = session(owner)
  if (!s?.started) return
  const generation = s.generation
  const current = s.questionId ? clean(MN.db.getNoteById(s.questionId)?.noteTitle) || s.title : s.title
  let result = await MNUtil.input("修改题目标题", "直接修改标题，或通过选项修改本题前缀和题号", ["取消", "选项", "确认"], { default: current })
  if (!result || result.button === 0) return
  if (session(owner) !== s || s.generation !== generation) { showHUD("当前题目已变化，请重新修改", 2); return }
  let choice = { index: 0 }
  let formatted = current, split = -1, oldPrefix = "", existingNumber: number | undefined
  if (result.button === 1) {
    const option = await select(["修改前缀", "修改题号"], "标题选项", "仅修改本题；改号后后续题目从新号码连续递增。", true)
    if (option.index < 0) return
    if (session(owner) !== s || s.generation !== generation) { showHUD("当前题目已变化，请重新修改", 2); return }
    choice = { index: option.index + 1 }
    formatted = s.questionId || s.manualTitle ? current : questionTitle(s, {}).title || current
    split = formatted.indexOf(" · ")
    oldPrefix = split >= 0 && titleNumber(formatted.split(" · ")[0]) === undefined ? formatted.slice(0, split) : ""
    existingNumber = titleNumber(formatted)
    result = await MNUtil.input(choice.index === 1 ? "修改本题前缀" : "修改本题题号",
      choice.index === 1 ? "仅修改本题，不改全局格式或母卡名称" : "输入正整数，后续题目按此号码加一继续",
      ["取消", "确认"], { default: choice.index === 1 ? oldPrefix : String(existingNumber || 1) })
    if (!result || result.button !== 1) return
  } else if (result.button !== 2) return
  if (session(owner) !== s || s.generation !== generation) { showHUD("当前题目已变化，请重新修改标题", 2); return }
  const input = clean(result.input)
  let title = input
  if (choice.index === 1) {
    const body = oldPrefix ? formatted.slice(split + 3) : formatted
    title = input ? `${input}${body ? ` · ${body}` : ""}` : body
  }
  if (choice.index === 2) {
    if (!/^[1-9][0-9]*$/.test(input) || !Number.isSafeInteger(Number(input))) { showHUD("请输入有效的正整数题号", 2); return }
    title = existingNumber ? formatted.replace(`第${existingNumber}题`, `第${Number(input)}题`) : `第${Number(input)}题${formatted ? ` · ${formatted}` : ""}`
  }
  if (!title) { showHUD("题目标题不能为空", 2); return }
  const number = titleNumber(title)
  if (s.questionId) {
    const question = MN.db.getNoteById(s.questionId)
    if (!question) { showHUD("当前题目卡片已不可用", 2); return }
    question.noteTitle = title
    commit(s.notebookId)
  }
  s.manualNumber = choice.index === 2 || s.settings.titleMode === "number" || s.manualNumber ? number : undefined
  if (s.questionId && s.manualNumber) rememberNumber(s, s.manualNumber)
  s.title = title; s.manualTitle = true; s.generation++
  if (s.stage === "title") s.stage = "question"
  s.changed()
  if (s.running) switchTool(s)
  showHUD("已修改题目标题", 2)
}
function attach(parent: any, child: any, notebookId: string): void {
  if (String(parent.notebookId) !== notebookId || String(child.notebookId) !== notebookId) throw new Error("卡片不属于当前学习集")
  const visited = new Set<string>()
  let cursor = parent
  while (cursor) {
    const id = String(cursor.noteId)
    if (id === String(child.noteId) || visited.has(id)) throw new Error("不能将卡片挂到自身或后代")
    visited.add(id); cursor = cursor.parentNote
  }
  if (String(child.parentNote?.noteId ?? "") === String(parent.noteId)) return
  child.removeFromParent?.()
  parent.addChild(child)
}
function handleExcerpt(s: ClipSession, id: string, expected: ClipStage, generation: number, fallback: string, retry = 0): void {
  if (session(s.owner) !== s || !s.running || s.stage !== expected || s.generation !== generation) return
  const note = MN.db.getNoteById(id) as any
  if (!note) {
    if (retry < 6) { NSTimer.scheduledTimerWithTimeInterval(.12, false, () => handleExcerpt(s, id, expected, generation, fallback, retry + 1)); return }
    s.issue = "暂时无法读取摘录卡片，请重新摘录"; s.changed(); showHUD(s.issue, 3); return
  }
  if (String(note.notebookId) !== s.notebookId) return
  try {
    if (expected === "title") {
      const title = clean(note.excerptText || note.noteTitle || fallback)
      if (!title) throw new Error("未读到标题文字，请重新摘录标题")
      s.title = title; s.manualTitle = false; s.manualNumber = undefined; s.tempTitleId = id; s.stage = "question"
    } else if (expected === "question") {
      if (id === s.tempTitleId) throw new Error("请关闭连续摘录，创建独立的题目卡片")
      const formatted = questionTitle(s, note)
      if (formatted.title) note.noteTitle = formatted.title
      if (s.motherId) {
        const mother = MN.db.getNoteById(s.motherId)
        if (!mother) throw new Error("母卡已不可用，请重新绑定或解除绑定")
        attach(mother, note, s.notebookId)
      }
      commit(s.notebookId)
      formatted.recordNumber?.()
      // Only remove the temporary title after the question has been saved.
      if (s.tempTitleId) { (MN.db as any).deleteBookNote(s.tempTitleId); s.tempTitleId = ""; commit(s.notebookId) }
      s.title = clean(note.noteTitle || note.excerptText) || "未命名题目"
      s.questionId = id; s.stage = "answer"
      if (!s.settings.excerptAnswer) completeClipperQuestion(s)
    } else {
      const question = MN.db.getNoteById(s.questionId)
      if (!question) throw new Error("当前题目卡片已不可用，请结束后重新开始摘题")
      attach(question, note, s.notebookId)
      note.noteTitle = `${clean(question.noteTitle) || s.title || "未命名题目"}答案`
      commit(s.notebookId)
      completeClipperQuestion(s)
    }
    s.issue = ""; s.generation++; s.changed(); switchTool(s)
    showHUD(expected === "title" ? "已摘录标题，接下来请摘录题目"
      : expected === "question" ? s.settings.excerptAnswer ? "已摘录题目，接下来请摘录答案" : `已摘录题目，本题完成；接下来请摘录${s.settings.excerptTitle ? "标题" : "题目"}`
        : `已摘录答案，本题完成；接下来请摘录${s.settings.excerptTitle ? "标题" : "题目"}`, 2)
  } catch (error) {
    s.issue = String((error as Error)?.message ?? error)
    s.changed(); showHUD(s.issue, 3)
  }
}
export function onProcessNewExcerpt(sender: any): void {
  const s = session()
  if (!s?.running) return
  try { if (!app().checkNotifySenderInWindow(sender, s.window)) return } catch { return }
  const id = String(sender?.userInfo?.noteid ?? sender?.userInfo?.noteId ?? "")
  if (!id || s.seen.has(id)) return
  s.seen.add(id)
  const stage = s.stage, generation = s.generation
  const fallback = stage === "title" ? clean(app().studyController(s.window)?.readerController?.currentDocumentController?.selectionText) : ""
  NSTimer.scheduledTimerWithTimeInterval(.12, false, () => handleExcerpt(s, id, stage, generation, fallback))
}
