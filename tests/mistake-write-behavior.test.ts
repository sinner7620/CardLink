/**
 * 错题写入路径行为级测试：mock marginnote 运行时，真正执行
 * confirmMistakeLevel / reviewMistakesByIds，验证——
 * 1. 撤销组锚定到记录所属学习集（notebookId/topicId）且写入目标卡片正确；
 * 2. 写后回读失败时回滚记录（blocked 状态下批次调用被取消落盘）；
 * 3. 卡片托管标签被清空时同步取消记录（标签即身份）。
 */
import { test, mock } from "node:test"
import assert from "node:assert/strict"

// ---------- marginnote 运行时 mock ----------
const notesById: Record<string, any> = {}
const refreshed: string[] = []
const syncDirty: string[] = []
const undoCalls: Array<{ action: string; notebookId: string }> = []
const nodeCreates: Array<{ noteId?: string; notebookId?: string }> = []
const noWriteNotes = new Set<string>()
let currentNotebookId = ""

const kv: Record<string, any> = {}
const defaultsKv: Record<string, any> = {}

function tagsOf(note: any): string[] {
  const out: string[] = []
  for (const comment of note?.comments ?? []) {
    if (comment && comment.type === "TextNote" && typeof comment.text === "string" && comment.text.startsWith("#")) {
      out.push(...comment.text.split(/\s+/).filter((part: string) => part.startsWith("#")).map((part: string) => part.slice(1)))
    }
  }
  return out
}

function setTagsOf(note: any, tags: string[]): void {
  if (noWriteNotes.has(note.noteId)) return // 模拟写入静默失败，回读保持旧标签
  const others = (note.comments ?? []).filter(
    (comment: any) => !(comment && comment.type === "TextNote" && typeof comment.text === "string" && comment.text.startsWith("#"))
  )
  const text = tags.map(tag => `#${tag}`).join(" ")
  note.comments = text ? [...others, { type: "TextNote", text }] : others
}

class FakeNodeNote {
  note: any
  notebookId: string
  constructor(note: any, notebookId: string) {
    this.note = note
    this.notebookId = notebookId
    nodeCreates.push({ noteId: note?.noteId, notebookId })
  }
  get tags() { return tagsOf(this.note) }
  set tags(next: string[]) { setTagsOf(this.note, next) }
  tidyupTags() {}
  get title() { return this.note?.title }
}

class FakeUndoManager {
  static sharedInstance() {
    return {
      undoGrouping(actionName: string, notebookId: string, block: () => void) {
        undoCalls.push({ action: actionName, notebookId })
        block()
      }
    }
  }
}

const marginnoteMock = {
  isNSNull: () => false,
  delay: async () => {},
  fetch: async () => { throw new Error("no network in tests") },
  popup: async () => ({ buttonIndex: 0 }),
  saveFile: () => {},
  showHUD: () => {},
  setTimeInterval: () => {},
  genNSURL: () => ({}),
  select: async () => 0,
  getObjCClassDeclar: () => "",
  getLocalDataByKey: (key: string) => kv[key],
  setLocalDataByKey: (value: any, key: string) => { kv[key] = value },
  isfileExists: () => false,
  readJSON: () => undefined,
  writeTextFile: () => {},
  NodeNote: FakeNodeNote,
  UndoManager: FakeUndoManager,
  MN: {
    error: () => {},
    currnetNotebookId: "",
    db: {
      getNoteById: (id: string) => notesById[id],
      getNotebookById: (id: string) => ({ topicId: id, notes: [] }),
      allNotebooks: () => [],
      setNotebookSyncDirty: (id: string) => syncDirty.push(id)
    },
    app: { refreshAfterDBChanged: (id: string) => refreshed.push(id), documentPath: undefined }
  }
}

;(globalThis as Record<string, unknown>).NSUserDefaults = {
  standardUserDefaults: () => ({
    objectForKey: (key: string) => defaultsKv[key],
    setObjectForKey: (value: any, key: string) => { defaultsKv[key] = value },
    doubleForKey: () => 0,
    setDoubleForKey: () => {},
    synchronize: () => {}
  })
}

mock.module("marginnote", { namedExports: marginnoteMock })

type Manager = typeof import("../src/mistake-manager")
type Store = typeof import("../src/mistake-store")
let manager: Manager
let store: Store
async function loadModules() {
  if (!manager) {
    manager = await import("../src/mistake-manager")
    store = await import("../src/mistake-store")
  }
}

// ---------- 测试数据 ----------
// loadMistakeState 有进程级缓存，种子记录必须通过 store API 注入活的 state。
let seq = 0
async function seedRecord(notebookId: string, noteId: string, level: number, options: { tagsWrittenAt?: boolean; cardTags?: string[] } = {}) {
  await loadModules()
  const now = new Date(Date.now() - 86400000).toISOString()
  const recordId = `${notebookId}:${noteId}`
  const record = {
    recordId,
    sourceNotebookId: notebookId,
    sourceNoteId: noteId,
    sourceNotebookTitle: `脑图 ${notebookId}`,
    sourceTitle: `题目 ${noteId}`,
    sourcePathTitles: ["第一章"],
    categoryPath: [`脑图 ${notebookId}`, "第一章"],
    manualCategory: undefined,
    manualCategories: [],
    level,
    levelModel: 3,
    reviewScheduleModel: 3,
    reviewCount: 0,
    createdAt: now,
    updatedAt: now,
    nextReviewAt: now,
    history: [] as any[],
    reviewCompleted: false,
    ...(options.tagsWrittenAt === false ? {} : { tagsWrittenAt: now })
  } as any
  const state = store.loadMistakeState()
  store.upsertMistakeRecord(state, record)
  store.saveMistakeState(state)
  notesById[noteId] = {
    noteId,
    title: `题目 ${noteId}`,
    comments: (options.cardTags ?? ["错题_不会"]).map(tag => ({ type: "TextNote", text: `#${tag}` }))
  }
  return recordId
}

function mistakeStateRecords(): Record<string, any> {
  const raw = kv["mn4-answer-matcher.mistakes.v2"]
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
  return parsed?.records ?? {}
}

test("取消已删除原卡片的错题：直接持久化删除，不访问学习集写入", async () => {
  const notebookId = `nbDeleted${seq++}`
  const noteId = `${notebookId}-note`
  const id = await seedRecord(notebookId, noteId, 0)
  delete notesById[noteId]
  await manager.removeMistakeById(id)
  assert.equal(mistakeStateRecords()[id], undefined)
  assert.ok(!undoCalls.some(call => call.notebookId === notebookId))
  assert.ok(!syncDirty.includes(notebookId))
})

test("批量取消：同学习集缺失卡片不阻塞正常卡片，返回实际删除记录", async () => {
  const notebookId = `nbMixed${seq++}`
  const deleted = await seedRecord(notebookId, `${notebookId}-deleted`, 0)
  const live = await seedRecord(notebookId, `${notebookId}-live`, 0, { cardTags: ["错题_不会", "用户标签"] })
  delete notesById[`${notebookId}-deleted`]
  const result = await manager.removeMistakesByIds([deleted, live, deleted, "nonexistent-record"])
  assert.equal(result.changed, 2)
  assert.equal(result.missing, 1)
  assert.deepEqual(result.records.map(record => record.recordId), [deleted, live])
  assert.equal(mistakeStateRecords()[deleted], undefined)
  assert.equal(mistakeStateRecords()[live], undefined)
  assert.deepEqual(tagsOf(notesById[`${notebookId}-live`]), ["用户标签"])
})

test("批量取消：同学习集标签写入失败仍可清理缺失卡片，保留失败记录", async () => {
  const notebookId = `nbBlockedRemove${seq++}`
  const deleted = await seedRecord(notebookId, `${notebookId}-deleted`, 0)
  const liveNote = `${notebookId}-live`
  const live = await seedRecord(notebookId, liveNote, 0)
  delete notesById[`${notebookId}-deleted`]
  noWriteNotes.add(liveNote)
  const result = await manager.removeMistakesByIds([deleted, live])
  assert.equal(result.changed, 1)
  assert.deepEqual(result.records.map(record => record.recordId), [deleted])
  assert.equal(mistakeStateRecords()[deleted], undefined)
  assert.ok(mistakeStateRecords()[live])
  await manager.removeMistakeById(live)
  assert.ok(mistakeStateRecords()[live])
})

test("取消时数据库读取抛错不能被当成原卡片已删除", async () => {
  const notebookId = `nbReadError${seq++}`
  const noteId = `${notebookId}-note`
  const id = await seedRecord(notebookId, noteId, 0)
  const original = marginnoteMock.MN.db.getNoteById
  marginnoteMock.MN.db.getNoteById = key => {
    if (key === noteId) throw new Error("读取失败")
    return original(key)
  }
  try {
    await manager.removeMistakeById(id)
    assert.ok(mistakeStateRecords()[id])
    const result = await manager.removeMistakesByIds([id])
    assert.equal(result.changed, 0)
    assert.ok(mistakeStateRecords()[id])
  } finally {
    marginnoteMock.MN.db.getNoteById = original
  }
})

test("原卡仅改标题后读取详情：保存新标题并使列表缓存失效，不改变复习计划", async () => {
  const notebookId = `nbRename${seq++}`
  const noteId = `${notebookId}-note`
  const id = await seedRecord(notebookId, noteId, 0)
  const before = mistakeStateRecords()[id]
  const oldList = manager.mistakeWorkbenchData()
  notesById[noteId].title = "修改后的题目标题"
  const detail = manager.mistakeDetailById(id)
  assert.equal(detail.record.sourceTitle, "修改后的题目标题")
  const saved = mistakeStateRecords()[id]
  assert.equal(saved.sourceTitle, detail.record.sourceTitle)
  assert.equal(saved.nextReviewAt, before.nextReviewAt)
  assert.equal(saved.reviewCount, before.reviewCount)
  assert.deepEqual(saved.history, before.history)
  const nextList = manager.mistakeWorkbenchData()
  assert.notEqual(nextList.revision, oldList.revision)
  assert.equal(nextList.records.find(record => record.recordId === id)?.sourceTitle, detail.record.sourceTitle)
  manager.mistakeDetailById(id)
  assert.equal(manager.mistakeWorkbenchRevision(), nextList.revision, "标题未变化时不反复更新版本")
})

test("待复习轻量原题读取同步标题，绑定手写仅加入本地预览", async () => {
  const notebookId = `nbQuestion${seq++}`
  const noteId = `${notebookId}-note`
  const id = await seedRecord(notebookId, noteId, 0)
  const db = marginnoteMock.MN.db as any
  const queried: string[][] = []
  db.getSketchNoteForMindMapFocusNoteId = (nb: string, note: string) => {
    queried.push([nb, note]); return { drawing: "bound-ink" }
  }
  db.getMediaByHash = () => ({ base64Encoding: () => "aW5r" })
  try {
    notesById[noteId].title = "待复习改名"
    const question = manager.mistakeQuestionById(id)
    assert.equal(question.record?.sourceTitle, "待复习改名")
    assert.equal(mistakeStateRecords()[id].sourceTitle, "待复习改名")
    assert.deepEqual(queried, [[notebookId, noteId]])
    assert.match(question.questionHtml, /data-bound-handwriting hidden/)
    assert.match(question.questionHtml, /data-drawing-id="mindmap-bound-ink"/)
    const aiQuestion = manager.createMistakeContentReader().readQuestion(id)
    assert.doesNotMatch(aiQuestion.questionHtml, /data-bound-handwriting hidden/)
    assert.equal(queried.length, 1, "AI只读提取不主动读取或夹带绑定笔迹")
    const { readBoundMindMapHandwriting, appendBoundMindMapHandwriting } = await import("../src/bound-handwriting")
    db.getSketchNoteForMindMapFocusNoteId = () => null
    assert.equal(readBoundMindMapHandwriting(notebookId, noteId).status, "none")
    db.getSketchNoteForMindMapFocusNoteId = () => { throw Error("不可读") }
    assert.equal(readBoundMindMapHandwriting(notebookId, noteId).status, "unreadable")
    const html = appendBoundMindMapHandwriting("<article></article>", { status: "included", assets: [{ hash: "ink", base64: "aW5r", kind: "drawing" }] })
    assert.doesNotMatch(html, /data-bound-handwriting hidden/, "OCR显式启用时绑定笔迹保持可见")
  } finally {
    delete db.getSketchNoteForMindMapFocusNoteId
    delete db.getMediaByHash
  }
})

test("并发错题分页初始化互不覆盖各自 transferId", async () => {
  await loadModules()
  await seedRecord(`nbP${seq}`, `nP${seq}`, 0)
  seq++
  const first = manager.beginMistakeWorkbenchTransfer()
  const second = manager.beginMistakeWorkbenchTransfer()
  assert.notEqual(first.transferId, second.transferId)
  assert.doesNotThrow(() => manager.continueMistakeWorkbenchTransfer(first.transferId, 0))
  assert.doesNotThrow(() => manager.continueMistakeWorkbenchTransfer(second.transferId, 0))
})

test("复习写入：撤销组锚定记录学习集，标签写到原卡片并推进计划", async () => {
  await loadModules()
  const recordId = await seedRecord(`nbW${seq}`, `nW${seq}`, 0)
  const notebookId = `nbW${seq}`
  seq++
  currentNotebookId = notebookId
  ;(marginnoteMock.MN as any).currnetNotebookId = notebookId

  const record = await manager.reviewMistakeById(recordId, 1)

  assert.equal(undoCalls[undoCalls.length - 1].action, "错题复习")
  assert.equal(undoCalls[undoCalls.length - 1].notebookId, notebookId, "撤销组必须锚定到记录所属学习集")
  assert.ok(
    nodeCreates.some(item => item.noteId === record.sourceNoteId && item.notebookId === notebookId),
    "NodeNote 必须用记录的 sourceNoteId + sourceNotebookId 构造"
  )
  assert.ok(refreshed.includes(notebookId), "写入提交后必须 refreshAfterDBChanged")
  assert.ok(syncDirty.includes(notebookId), "提交后必须标记学习集同步脏位")
  const tags = tagsOf(notesById[record.sourceNoteId])
  assert.ok(tags.includes("错题_不熟"), `回读应包含新等级标签：${tags}`)
  assert.ok(!tags.includes("错题_不会"), "旧等级标签应被清理")
  const stored = mistakeStateRecords()[recordId]
  assert.equal(stored.level, 1)
  assert.equal(stored.reviewCount, 0, "换档后复测次数归零")
  assert.ok(stored.tagsWrittenAt, "写入验证通过后必须带 tagsWrittenAt")
  const dueAt = new Date(stored.nextReviewAt).getTime()
  const expected = Date.now() + 2 * 86400000 // 不熟曲线 [2,5,10] 首间隔
  assert.ok(Math.abs(dueAt - expected) < 60_000, `下次复习应为 2 天后：${stored.nextReviewAt}`)
})

test("写入校验失败：记录回滚为原等级，不标记提交", async () => {
  await loadModules()
  const notebookId = `nbF${seq}`
  const recordId = await seedRecord(notebookId, `nF${seq}`, 0)
  seq++
  noWriteNotes.add(`nF${seq - 1}`)
  ;(marginnoteMock.MN as any).currnetNotebookId = notebookId

  await assert.rejects(() => manager.reviewMistakeById(recordId, 1), /未能写入原题标签/)
  const stored = mistakeStateRecords()[recordId]
  assert.equal(stored.level, 0, "失败后记录必须回滚")
  assert.equal(stored.reviewCount, 0)
  assert.ok(!refreshed.includes(notebookId), "未提交不得 refreshAfterDBChanged")
  assert.ok(!undoCalls.some(call => call.notebookId === notebookId && false))
})

test("写入后无法回读：不得乐观提交数据库状态", async () => {
  await loadModules()
  const notebookId = `nbU${seq}`
  const noteId = `nU${seq}`
  const recordId = await seedRecord(notebookId, noteId, 0)
  seq++
  ;(marginnoteMock.MN as any).currnetNotebookId = notebookId

  const note = notesById[noteId]
  let comments = note.comments
  let reads = 0
  Object.defineProperty(note, "comments", {
    configurable: true,
    get() {
      reads++
      if (reads >= 3) throw new Error("模拟写后回读不可用")
      return comments
    },
    set(value) { comments = value }
  })

  await assert.rejects(() => manager.reviewMistakeById(recordId, 1), /未能写入原题标签/)
  const stored = mistakeStateRecords()[recordId]
  assert.equal(stored.level, 0, "无法回读时数据库必须回滚，不能把 unverified 当成功")
  assert.ok(!refreshed.includes(notebookId), "无法回读时不得提交数据库刷新")
})

test("收藏以 recordId 持久化，同名题互不影响且旧标题只迁移唯一记录", async () => {
  await loadModules()
  const first = await seedRecord(`nbFavA${seq}`, `nFavA${seq}`, 0)
  const second = await seedRecord(`nbFavB${seq}`, `nFavB${seq}`, 1)
  const unique = await seedRecord(`nbFavC${seq}`, `nFavC${seq}`, 2)
  seq++
  const state = store.loadMistakeState()
  state.records[first].sourceTitle = "同名题"
  state.records[second].sourceTitle = "同名题"
  state.records[unique].sourceTitle = "唯一题"
  store.saveMistakeState(state)

  manager.setMistakeFavoriteById(first, true)
  let records = mistakeStateRecords()
  assert.equal(records[first].favorite, true)
  assert.notEqual(records[second].favorite, true, "收藏一条同名题不能连带另一条")

  const migrated = manager.migrateLegacyMistakeFavorites(["同名题", "唯一题"])
  assert.deepEqual(migrated, { migrated: 1, ambiguous: 1 })
  records = mistakeStateRecords()
  assert.notEqual(records[second].favorite, true, "歧义旧标题不得批量迁移")
  assert.equal(records[unique].favorite, true)
})

test("批量复习：写入失败的学习集被取消落盘，其余正常更新", async () => {
  await loadModules()
  const okNotebook = `nbB${seq}`
  const okRecord = await seedRecord(okNotebook, `nB${seq}`, 0)
  const failNotebook = `nbC${seq}`
  const failRecord = await seedRecord(failNotebook, `nC${seq}`, 0)
  seq++
  noWriteNotes.add(`nC${seq - 1}`)
  ;(marginnoteMock.MN as any).currnetNotebookId = okNotebook

  const result = await manager.reviewMistakesByIds([okRecord, failRecord, "ghost:1"], 2)

  assert.equal(result.changed, 1, "只有写入验证通过的学习集计入")
  assert.equal(result.missing, 1)
  const okStored = mistakeStateRecords()[okRecord]
  const failStored = mistakeStateRecords()[failRecord]
  assert.equal(okStored.level, 2)
  assert.ok(okStored.tagsWrittenAt)
  assert.equal(failStored.level, 0, "失败学习集的记录必须保留原状态")
  assert.ok(refreshed.includes(okNotebook))
  assert.ok(!refreshed.includes(failNotebook))
})

test("卡片托管标签被清空：复习调用同步取消记录（标签即身份）", async () => {
  await loadModules()
  const notebookId = `nbX${seq}`
  const recordId = await seedRecord(notebookId, `nX${seq}`, 0, { cardTags: [] })
  seq++
  ;(marginnoteMock.MN as any).currnetNotebookId = notebookId

  await assert.rejects(() => manager.reviewMistakeById(recordId, 1), /记录已同步取消/)
  assert.ok(!mistakeStateRecords()[recordId], "取消的记录必须从库中删除")
})

test("未写过标签的旧记录：无托管标签也不能通过复习复活，历史先归档", async () => {
  await loadModules()
  const notebookId = `nbL${seq}`
  const recordId = await seedRecord(notebookId, `nL${seq}`, 2, { tagsWrittenAt: false, cardTags: [] })
  seq++
  ;(marginnoteMock.MN as any).currnetNotebookId = notebookId

  await assert.rejects(() => manager.reviewMistakeById(recordId, 2), /记录已同步取消/)
  assert.ok(!mistakeStateRecords()[recordId])
  assert.equal(tagsOf(notesById["nL" + (seq - 1)]).length, 0)
  assert.ok(JSON.parse(kv["mn4-answer-matcher.mistakes.detached-archive.v1"])[recordId])
})

test("刷新按卡片事实清理旧元数据；无旧标签时不写卡片标签、不调用整库 savedb", async () => {
  const id = await seedRecord("refresh", "refresh-no-tag", 0, { tagsWrittenAt: false, cardTags: [] })
  const unknown = await seedRecord("refresh", "refresh-unknown", 0)
  Object.defineProperty(notesById["refresh-unknown"], "comments", { configurable: true, get() { throw new Error("暂不可读") } })
  const partial = await seedRecord("refresh", "refresh-partial", 0)
  notesById["refresh-partial"].comments = [{ get type() { throw new Error("NSNull") } }]
  const before = undoCalls.length
  await manager.repairAndOrganizeMistakes()
  assert.equal(undoCalls.length, before)
  assert.equal(tagsOf(notesById["refresh-no-tag"]).length, 0)
  assert.ok(!mistakeStateRecords()[id])
  assert.ok(mistakeStateRecords()[unknown])
  assert.ok(mistakeStateRecords()[partial])
  assert.ok(JSON.parse(kv["mn4-answer-matcher.mistakes.detached-archive.v1"])[id])
  await manager.repairAndOrganizeMistakes()
  assert.ok(!mistakeStateRecords()[id], "再次刷新不能从归档复活")
})

test("刷新将旧错题标签原位改写为当前三级标签并保留普通标签", async () => {
  await seedRecord("legacy-tags", "legacy-zero", 0, { cardTags: ["错题", "错题0级", "普通标签"] })
  await seedRecord("legacy-tags", "legacy-three", 1, { cardTags: ["错题", "错题3级", "计算题"] })
  await seedRecord("legacy-tags", "legacy-five", 2, { cardTags: ["错题", "错题5级", "易错"] })

  await manager.repairAndOrganizeMistakes()

  assert.deepEqual(tagsOf(notesById["legacy-zero"]), ["错题_不会", "普通标签"])
  assert.deepEqual(tagsOf(notesById["legacy-three"]), ["错题_不熟", "计算题"])
  assert.deepEqual(tagsOf(notesById["legacy-five"]), ["错题_掌握", "易错"])
})

test("刷新以原卡真实学习集重建 recordId，并保留收藏与复测历史", async () => {
  const noteId = `moved-${seq++}`
  const oldId = await seedRecord("stale-notebook", noteId, 0)
  const state = store.loadMistakeState()
  state.records[oldId] = {
    ...state.records[oldId],
    favorite: true,
    reviewCount: 1,
    history: [{ at: "2026-09-01T00:00:00.000Z", level: 0 }]
  }
  store.saveMistakeState(state)
  notesById[noteId].notebookId = "actual-notebook"

  await manager.repairAndOrganizeMistakes()

  const records = mistakeStateRecords()
  const migrated = records[`actual-notebook:${noteId}`]
  assert.ok(migrated)
  assert.ok(!records[oldId])
  assert.equal(migrated.sourceNotebookId, "actual-notebook")
  assert.equal(migrated.favorite, true)
  assert.equal(migrated.history.length, 1)
})

test("纯答案范围旧记录只归档，不凭同名恢复原题或重写答案标签", async () => {
  const bindings = await import("../src/store")
  bindings.saveBindings({ "question-scope": { notebookId: "answer-scope" } })
  const id = await seedRecord("answer-scope", "answer-only-card", 0)
  const before = undoCalls.length
  const tags = tagsOf(notesById["answer-only-card"])
  await manager.repairAndOrganizeMistakes()
  assert.ok(!mistakeStateRecords()[id])
  assert.ok(JSON.parse(kv["mn4-answer-matcher.mistakes.detached-archive.v1"])[id])
  assert.equal(undoCalls.length, before)
  assert.deepEqual(tagsOf(notesById["answer-only-card"]), tags)
  bindings.saveBindings({})
})

test("保存不再写快照键，旧迁移源键被置空瘦身", async () => {
  await loadModules()
  // 种入旧键数据（模拟升级残留）
  kv["marginnote.extension.mn4-answer-matcher.mistakes.v2"] = '{"version":2,"records":{}}'
  kv["mn4-answer-matcher.mistakes.v1"] = '{"version":1,"records":{}}'
  const state = store.loadMistakeState()
  store.saveMistakeState(state)
  const snapshotKey = "marginnote.extension.mn4-answer-matcher.mistakes.snapshot.v1"
  assert.ok(!(snapshotKey in defaultsKv) || defaultsKv[snapshotKey] === "", "快照键应不再写入/已被清空")
  assert.equal(kv["mn4-answer-matcher.mistakes.v1"], "", "v1 旧键应被置空")
  const legacyBackup = defaultsKv["marginnote.extension.mn4-answer-matcher.mistakes.v2"]
  assert.ok(legacyBackup === "" || legacyBackup === undefined, "旧 NSUserDefaults 备份键应被置空")
  // 主存储与新备份文件不受清理影响
  assert.ok(typeof kv["mn4-answer-matcher.mistakes.v2"] === "string" && (kv["mn4-answer-matcher.mistakes.v2"] as string).length > 2)
})
