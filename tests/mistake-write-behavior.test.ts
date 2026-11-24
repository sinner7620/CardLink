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
const forbiddenNotebookScans = new Set<string>()
const refreshed: string[] = []
const syncDirty: string[] = []
const undoCalls: Array<{ action: string; notebookId: string }> = []
const nodeCreates: Array<{ noteId?: string; notebookId?: string }> = []
const noWriteNotes = new Set<string>()
const dropReasonTags = new Set<string>()
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
  if (dropReasonTags.has(note.noteId)) tags = tags.filter(tag => !tag.startsWith('错因_'))
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
  get titles() { return [this.title].filter(Boolean) }
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
      getNotebookById: (id: string) => ({ topicId: id, get notes() {
        if (forbiddenNotebookScans.has(id)) throw new Error("单题详情不应全量扫描学习集")
        return []
      } }),
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

test('保留错因的单卡等级保存保留原卡多项错因和旧历史，不伪造本次错因', async () => {
  for (const level of [0, 1, 2] as const) {
    const book = `preserve-mark-${level}`, noteId = `${book}-note`
    const id = await seedRecord(book, noteId, 1, { cardTags: ['错题_不熟', '用户标签', '错因_审题遗漏', '错因_时间不足'] })
    const state = store.loadMistakeState()
    const oldHistory = [{ at: state.records[id].createdAt, level: 1 as const, errorReason: { key: 'reading', label: '审题遗漏' } }]
    store.upsertMistakeRecord(state, { ...state.records[id], history: oldHistory })
    store.saveMistakeState(state)
    const saved = await manager.markQuestionAsMistake(new FakeNodeNote(notesById[noteId], book) as any, book, level, undefined, true)
    assert.ok(saved)
    const record = mistakeStateRecords()[id]
    assert.equal(record.level, level)
    assert.equal(record.history.length, 2)
    assert.deepEqual(record.history[0], oldHistory[0])
    assert.equal(record.history[1].errorReason, undefined)
    assert.equal(record.reviewCount, level === 1 ? 1 : 0)
    assert.ok(tagsOf(notesById[noteId]).includes('错因_审题遗漏'))
    assert.ok(tagsOf(notesById[noteId]).includes('错因_时间不足'))
    assert.ok(tagsOf(notesById[noteId]).includes('用户标签'))
    assert.ok(manager.mistakeReasonHistoryId(saved))
  }
})

test('侧边单项和多项等级保留错因，默认等级与批量入口仍清除未选错因', async () => {
  const book = 'preserve-side-book', noteId = 'preserve-side-note'
  const id = await seedRecord(book, noteId, 1, { cardTags: ['错题_不熟', '错因_计算失误', '用户标签'] })
  await manager.changeMistakeLevelById(id, 2, { key: 'time', label: '时间不足' }, true)
  assert.ok(tagsOf(notesById[noteId]).includes('错因_计算失误'))
  assert.ok(!tagsOf(notesById[noteId]).includes('错因_时间不足'))
  assert.equal(mistakeStateRecords()[id].history[0].errorReason, undefined)
  await manager.changeMistakeLevelById(id, 0, undefined, true)
  assert.ok(tagsOf(notesById[noteId]).includes('错因_计算失误'))
  const newId = 'preserve-side-new'
  notesById[newId] = { noteId: newId, title: '新题', comments: [{ type: 'TextNote', text: '#错因_时间不足 #用户标签' }] }
  const cards = [noteId, newId].map(note => new FakeNodeNote(notesById[note], book)) as any
  const beforeUndo = undoCalls.length
  const batch = await manager.markQuestionsAsMistakes(cards, book, 1, undefined, true)
  assert.equal(batch.updated, 1)
  assert.equal(batch.added, 1)
  assert.equal(undoCalls.length - beforeUndo, 1, '保留批量单次学习集事务')
  assert.ok(tagsOf(notesById[noteId]).includes('错因_计算失误'))
  assert.ok(tagsOf(notesById[newId]).includes('错因_时间不足'))
  for (const record of batch.records) assert.equal(record.history[record.history.length - 1]?.errorReason, undefined)
  await manager.markQuestionsAsMistakes(cards, book, 2, { key: 'reading', label: '审题遗漏' }, true)
  assert.ok(tagsOf(notesById[noteId]).includes('错因_计算失误'))
  assert.ok(tagsOf(notesById[newId]).includes('错因_时间不足'))
  for (const recordId of [id, `${book}:${newId}`]) assert.equal(mistakeStateRecords()[recordId].history.at(-1).errorReason, undefined)
  await manager.changeMistakeLevelById(id, 0)
  assert.ok(!tagsOf(notesById[noteId]).some(tag => tag.startsWith('错因_')))
  await manager.markQuestionsAsMistakes(cards, book, 1)
  assert.ok(!tagsOf(notesById[newId]).some(tag => tag.startsWith('错因_')))
  await manager.markQuestionAsMistake(cards[0], book, 1, { key: 'reading', label: '审题遗漏' })
  await manager.markQuestionAsMistake(cards[0], book, 1)
  assert.ok(!tagsOf(notesById[noteId]).some(tag => tag.startsWith('错因_')))
})

test('补写只更新刚保存的一次历史与错因标签，不增加复测次数或改变计划和手动队列', async () => {
  const book = 'supplement-book', noteId = 'supplement-note'
  const id = await seedRecord(book, noteId, 1, { cardTags: ['错题_不熟', '用户标签', '错因_概念不清'] })
  const state = store.loadMistakeState()
  const oldHistory = [{ at: state.records[id].createdAt, level: 1 as const, errorReason: { key: 'concept', label: '概念不清' } }]
  store.upsertMistakeRecord(state, { ...state.records[id], history: oldHistory })
  store.saveMistakeState(state)
  const saved = await manager.markQuestionAsMistake(new FakeNodeNote(notesById[noteId], book) as any, book, 1, undefined, true)
  assert.ok(saved)
  const historyId = manager.mistakeReasonHistoryId(saved)
  assert.ok(historyId)
  const before = mistakeStateRecords()[id]
  const manualQueue = await import('../src/manual-review-queue')
  const queueNow = new Date(Date.parse(saved.nextReviewAt) + 2 * 86400000)
  const records = store.loadMistakeState().records
  manualQueue.addOverdueToToday({ [id]: records[id] }, 1, queueNow)
  const queueBefore = manualQueue.manualTodayIds(records, queueNow)
  assert.deepEqual(queueBefore, [id])
  const queueStorageBefore = JSON.stringify(kv['mn4-answer-matcher.manual-review-queue.v1'])
  const reason = { key: 'reading', label: '审题遗漏' }
  const supplemented = await manager.supplementMistakeReasonById(id, reason, historyId)
  let after = mistakeStateRecords()[id]
  assert.equal(after.history.length, before.history.length)
  assert.deepEqual(after.history[0], oldHistory[0])
  assert.deepEqual(after.history[1], { ...before.history[1], errorReason: reason })
  for (const key of ['level', 'reviewCount', 'nextReviewAt', 'lastReviewedAt', 'reviewCompleted', 'createdAt']) assert.equal(after[key], before[key], key)
  assert.deepEqual(manualQueue.manualTodayIds(records, queueNow), queueBefore)
  assert.equal(JSON.stringify(kv['mn4-answer-matcher.manual-review-queue.v1']), queueStorageBefore)
  assert.equal(manager.mistakeReasonHistoryId(supplemented), historyId)
  assert.deepEqual(tagsOf(notesById[noteId]).sort(), ['错题_不熟', '用户标签', '错因_审题遗漏'].sort())
  await manager.supplementMistakeReasonById(id, reason, historyId)
  after = mistakeStateRecords()[id]
  assert.equal(after.history.length, before.history.length)
  assert.equal(after.reviewCount, before.reviewCount)
  assert.equal(after.nextReviewAt, before.nextReviewAt)
  manualQueue.removeFromManualToday(id, records, queueNow)
})

test('新题首次等级保存可以补写同一次历史，不变成第一次复测', async () => {
  await loadModules()
  const book = 'supplement-new-book', noteId = 'supplement-new-note'
  notesById[noteId] = { noteId, title: '首次标记', comments: [] }
  const saved = await manager.markQuestionAsMistake(new FakeNodeNote(notesById[noteId], book) as any, book, 0, undefined, true)
  assert.ok(saved)
  await manager.supplementMistakeReasonById(saved.recordId, { key: 'concept', label: '概念不清' }, manager.mistakeReasonHistoryId(saved))
  const after = mistakeStateRecords()[saved.recordId]
  assert.equal(after.history.length, 1)
  assert.equal(after.reviewCount, 0)
  assert.equal(after.lastReviewedAt, undefined)
  assert.equal(after.nextReviewAt, saved.nextReviewAt)
  assert.equal(after.history[0].errorReason.key, 'concept')
})

test('补写标签失败不改变旧记录，保留回执重试不会增加历史或复测', async () => {
  const book = 'supplement-retry-book', noteId = 'supplement-retry-note'
  const id = await seedRecord(book, noteId, 0, { cardTags: ['错题_不会', '错因_计算失误'] })
  const saved = await manager.markQuestionAsMistake(new FakeNodeNote(notesById[noteId], book) as any, book, 0, undefined, true)
  assert.ok(saved)
  const receipt = manager.mistakeReasonHistoryId(saved)
  const before = JSON.stringify(mistakeStateRecords()[id])
  noWriteNotes.add(noteId)
  try {
    await assert.rejects(manager.supplementMistakeReasonById(id, { key: 'reading', label: '审题遗漏' }, receipt), /mistakeTagWriteFailed|标签|写入/)
    assert.equal(JSON.stringify(mistakeStateRecords()[id]), before)
    assert.ok(tagsOf(notesById[noteId]).includes('错因_计算失误'))
  } finally { noWriteNotes.delete(noteId) }
  dropReasonTags.add(noteId)
  try {
    await assert.rejects(manager.supplementMistakeReasonById(id, { key: 'reading', label: '审题遗漏' }, receipt), /mistakeTagWriteFailed|标签|写入/)
    assert.equal(JSON.stringify(mistakeStateRecords()[id]), before)
  } finally { dropReasonTags.delete(noteId) }
  await manager.supplementMistakeReasonById(id, { key: 'reading', label: '审题遗漏' }, receipt)
  assert.equal(mistakeStateRecords()[id].history.length, saved.history.length)
  assert.equal(mistakeStateRecords()[id].reviewCount, saved.reviewCount)
  assert.equal(mistakeStateRecords()[id].nextReviewAt, saved.nextReviewAt)
  assert.ok(tagsOf(notesById[noteId]).includes('错因_审题遗漏'))
})

test('同毫秒同等级的旧回执和跨题回执均不能写入更晚历史或原卡', async () => {
  const book = 'supplement-stale-book', noteId = 'supplement-stale-note'
  const id = await seedRecord(book, noteId, 1, { cardTags: ['错题_不熟', '错因_计算失误'] })
  const question = new FakeNodeNote(notesById[noteId], book) as any
  const saved = await manager.markQuestionAsMistake(question, book, 1, undefined, true)
  assert.ok(saved)
  const oldReceipt = manager.mistakeReasonHistoryId(saved)
  const newer = await manager.markQuestionAsMistake(question, book, 1, undefined, true)
  assert.ok(newer)
  const state = store.loadMistakeState()
  const history = state.records[id].history.map((entry, index) => index === state.records[id].history.length - 1
    ? { ...entry, at: saved.history[saved.history.length - 1].at } : entry)
  store.upsertMistakeRecord(state, { ...state.records[id], history })
  store.saveMistakeState(state)
  const before = JSON.stringify(mistakeStateRecords()[id]), tagsBefore = tagsOf(notesById[noteId]), writesBefore = undoCalls.length
  await assert.rejects(manager.supplementMistakeReasonById(id, { key: 'time', label: '时间不足' }, oldReceipt), /记录已变化/)
  assert.equal(JSON.stringify(mistakeStateRecords()[id]), before)
  assert.deepEqual(tagsOf(notesById[noteId]), tagsBefore)
  assert.equal(undoCalls.length, writesBefore)
  const otherNoteId = 'supplement-other-note'
  await seedRecord(book, otherNoteId, 1, { cardTags: ['错题_不熟'] })
  const other = await manager.markQuestionAsMistake(new FakeNodeNote(notesById[otherNoteId], book) as any, book, 1, undefined, true)
  assert.ok(other)
  const otherBefore = JSON.stringify(mistakeStateRecords()[other.recordId])
  await assert.rejects(manager.supplementMistakeReasonById(other.recordId, { key: 'time', label: '时间不足' }, manager.mistakeReasonHistoryId(state.records[id])), /记录已变化/)
  assert.equal(JSON.stringify(mistakeStateRecords()[other.recordId]), otherBefore)
  assert.deepEqual(tagsOf(notesById[otherNoteId]), ['错题_不熟'])
})

test('补写不复活取消错题、不覆盖原卡新等级；掌握和无历史记录不能补写', async () => {
  const book = 'supplement-guard-book', noteId = 'supplement-guard-note'
  const id = await seedRecord(book, noteId, 1, { cardTags: ['错题_不熟', '错因_概念不清'] })
  const question = new FakeNodeNote(notesById[noteId], book) as any
  const saved = await manager.markQuestionAsMistake(question, book, 1, undefined, true)
  assert.ok(saved)
  const reason = { key: 'reading', label: '审题遗漏' }, receipt = manager.mistakeReasonHistoryId(saved)
  const before = JSON.stringify(mistakeStateRecords()[id])
  for (const tags of [[], ['错题_不会', '错因_概念不清']]) {
    setTagsOf(notesById[noteId], tags)
    await assert.rejects(manager.supplementMistakeReasonById(id, reason, receipt), /mistakeTagWriteFailed|标签|写入/)
    assert.equal(JSON.stringify(mistakeStateRecords()[id]), before)
    assert.deepEqual(tagsOf(notesById[noteId]), tags)
  }
  setTagsOf(notesById[noteId], ['错题_不熟', '错因_概念不清'])
  const mastered = await manager.markQuestionAsMistake(question, book, 2, reason, true)
  assert.ok(mastered)
  const masteredBefore = JSON.stringify(mistakeStateRecords()[id])
  await assert.rejects(manager.supplementMistakeReasonById(id, reason, manager.mistakeReasonHistoryId(mastered)), /掌握/)
  assert.equal(JSON.stringify(mistakeStateRecords()[id]), masteredBefore)
  assert.equal(mistakeStateRecords()[id].history.at(-1).errorReason, undefined)
  assert.ok(tagsOf(notesById[noteId]).includes('错因_概念不清'))
  const empty = await seedRecord(book, 'supplement-no-history', 0)
  await assert.rejects(manager.supplementMistakeReasonById(empty, reason), /记录已变化/)
  assert.equal(manager.mistakeReasonHistoryId(store.loadMistakeState().records[empty]), undefined)
})

test('固定复习的错因随本次历史真正落盘，后续未选错因不沿用旧值', async () => {
  const id = await seedRecord('reason-notebook', 'reason-note', 0)
  await manager.reviewMistakeById(id, 1, { key: 'reading', label: '审题遗漏' })
  assert.equal(mistakeStateRecords()[id].history[0].errorReason.key, 'reading')
  assert.ok(tagsOf(notesById['reason-note']).includes('错因_审题遗漏'))
  assert.deepEqual(manager.mistakeWorkbenchData().records.find(r => r.recordId === id)?.manualCategories, [])
  await manager.reviewMistakeById(id, 1, { key: 'calculation', label: '计算失误' })
  assert.ok(tagsOf(notesById['reason-note']).includes('错因_计算失误'))
  assert.ok(!tagsOf(notesById['reason-note']).includes('错因_审题遗漏'))
  await manager.reviewMistakeById(id, 2)
  const history = mistakeStateRecords()[id].history
  assert.equal(history[0].errorReason.label, '审题遗漏')
  assert.equal(history[1].errorReason.label, '计算失误')
  assert.equal(history[2].errorReason, undefined)
  assert.ok(!tagsOf(notesById['reason-note']).some(tag => tag.startsWith('错因_')))
})

test('智能复习错因仅改卡片错因标签，不改固定等级或固定历史', async () => {
  const id = await seedRecord('fsrs-reason-book', 'fsrs-reason-note', 1, { cardTags: ['错题_不熟', '用户标签'] })
  const before = JSON.stringify(mistakeStateRecords()[id])
  manager.syncMistakeReasonTags(id, [{ key: 'reading', label: '审题遗漏' }, { key: 'time', label: '时间不足' }])
  assert.deepEqual(tagsOf(notesById['fsrs-reason-note']), ['错题_不熟', '用户标签', '错因_审题遗漏', '错因_时间不足'])
  const { reasonTags, ...fixedReview } = mistakeStateRecords()[id]
  assert.deepEqual(reasonTags, ["错因_审题遗漏", "错因_时间不足"])
  assert.deepEqual(JSON.parse(JSON.stringify(fixedReview)), JSON.parse(before))
  await manager.setMistakeCategoryById(id, ['新分类'])
  assert.ok(tagsOf(notesById['fsrs-reason-note']).includes('错因_审题遗漏'))
  assert.ok(tagsOf(notesById['fsrs-reason-note']).includes('错因_时间不足'))
  manager.syncMistakeReasonTags(id, [])
  assert.ok(!tagsOf(notesById['fsrs-reason-note']).some(tag => tag.startsWith('错因_')))
  assert.ok(tagsOf(notesById['fsrs-reason-note']).includes('新分类'))
})

test('等级标签成功但错因标签静默丢失时，反馈不算写入成功', async () => {
  const id = await seedRecord('partial-reason-book', 'partial-reason-note', 1)
  const before = JSON.stringify(mistakeStateRecords()[id])
  dropReasonTags.add('partial-reason-note')
  try {
    await assert.rejects(manager.reviewMistakeById(id, 1, { key: 'reading', label: '审题遗漏' }), /mistakeTagWriteFailed|标签|写入/)
    assert.equal(JSON.stringify(mistakeStateRecords()[id]), before)
    assert.throws(() => manager.syncMistakeReasonTags(id, [{ key: 'time', label: '时间不足' }]), /错因标签/)
  } finally { dropReasonTags.delete('partial-reason-note') }
})

test('单卡已有记录写入失败返回未保存并回滚历史，修复标签后可重试', async () => {
  const book = 'single-panel-failed-book', noteId = 'single-panel-failed-note'
  const id = await seedRecord(book, noteId, 1, { cardTags: ['错题_不熟', '保留'] })
  const question = new FakeNodeNote(notesById[noteId], book) as any
  const before = JSON.stringify(mistakeStateRecords()[id])
  noWriteNotes.add(noteId)
  try {
    assert.equal(await manager.markQuestionAsMistake(question, book, 0), undefined)
    assert.equal(JSON.stringify(mistakeStateRecords()[id]), before)
  } finally { noWriteNotes.delete(noteId) }
  dropReasonTags.add(noteId)
  try {
    assert.equal(await manager.markQuestionAsMistake(question, book, 1, { key: 'reading', label: '审题遗漏' }), undefined)
    assert.equal(JSON.stringify(mistakeStateRecords()[id]), before)
  } finally { dropReasonTags.delete(noteId) }
  const saved = await manager.markQuestionAsMistake(question, book, 1, { key: 'reading', label: '审题遗漏' })
  assert.ok(saved)
  assert.equal(mistakeStateRecords()[id].history.length, 1)
  assert.equal(mistakeStateRecords()[id].history[0].errorReason.key, 'reading')
  assert.ok(tagsOf(notesById[noteId]).includes('错因_审题遗漏'))
  assert.ok(tagsOf(notesById[noteId]).includes('保留'))
})

test('单卡标记和批量标记都将自定义错因写入各自原卡，取消错题清除错因', async () => {
  const book = 'mark-reason-book'
  const first = await seedRecord(book, 'mark-reason-one', 0, { cardTags: ['错题_不会', '保留'] })
  const second = await seedRecord(book, 'mark-reason-two', 0)
  const reason = { key: 'custom', label: '新错因名称' }
  await manager.markQuestionAsMistake(new FakeNodeNote(notesById['mark-reason-one'], book) as any, book, 0, reason)
  assert.ok(tagsOf(notesById['mark-reason-one']).includes('错因_新错因名称'))
  await manager.markQuestionsAsMistakes(['mark-reason-one', 'mark-reason-two'].map(id => new FakeNodeNote(notesById[id], book)) as any, book, 1, { key: 'reading', label: '审题遗漏' })
  for (const noteId of ['mark-reason-one', 'mark-reason-two']) {
    assert.ok(tagsOf(notesById[noteId]).includes('错因_审题遗漏'))
    assert.ok(!tagsOf(notesById[noteId]).includes('错因_新错因名称'))
  }
  await manager.removeMistakesByIds([first, second])
  assert.deepEqual(tagsOf(notesById['mark-reason-one']), ['保留'])
})

test("混合绑定其他脑图时，详情/轻量原题/只读提取不夹带子卡答案；纯脑图模式保留子卡内容", async () => {
  const book = `mixedPreview${seq++}`
  const id = await seedRecord(book, `${book}-q`, 0)
  const source = notesById[`${book}-q`]
  source.childMindMap = { noteId: `${book}-root` }
  source.colorIndex = 0
  source.excerptText = "QUESTION_MARKER"
  source.childNotes = [{ noteId: `${book}-a`, noteTitle: "答案子卡", excerptText: "ANSWER_MARKER" }]
  const bindings = await import("../src/store")
  const previousBindings = bindings.loadBindings()
  forbiddenNotebookScans.add(book)
  try {
    for (const targetBook of [book, `${book}-other`]) {
      bindings.saveBindings({ [`${book}::root::${book}-root`]: {
        notebookId: targetBook, rootNodeId: "separate-answer-map", selectionMode: "mixed", questionColors: [0]
      } })
      for (const html of [manager.mistakeDetailById(id, "question").questionHtml,
        manager.mistakeQuestionById(id).questionHtml, manager.createMistakeContentReader().readQuestion(id).questionHtml]) {
        assert.match(html, /QUESTION_MARKER/)
        assert.doesNotMatch(html, /ANSWER_MARKER/)
      }
    }
    bindings.saveBindings({ [`${book}::root::${book}-root`]: {
      notebookId: "answers", designatedAnswer: "mindmap", questionColors: [0]
    } })
    assert.match(manager.mistakeQuestionById(id).questionHtml, /ANSWER_MARKER/)
    bindings.saveBindings({ [`${book}::root::${book}-root`]: {
      notebookId: "answers", selectionMode: "mixed", questionColors: [1]
    } })
    assert.match(manager.mistakeQuestionById(id).questionHtml, /ANSWER_MARKER/)
  } finally { bindings.saveBindings(previousBindings); forbiddenNotebookScans.delete(book) }
})

test("批量标记逐卡保存成功项，单卡失败不丢其他复测历史；去重且只提交一次学习集", async () => {
  const book = `batchMark${seq++}`
  const goodId = await seedRecord(book, `${book}-good`, 0)
  const badId = await seedRecord(book, `${book}-bad`, 0)
  const badNote = `${book}-bad`, newNote = `${book}-new`
  notesById[newNote] = { noteId: newNote, title: "新题", comments: [{ type: "TextNote", text: "#用户标签" }] }
  const beforeBad = JSON.parse(JSON.stringify(mistakeStateRecords()[badId]))
  const beforeUndo = undoCalls.length
  noWriteNotes.add(badNote)
  try {
    const cards = [`${book}-good`, badNote, newNote, `${book}-good`].map(id => new FakeNodeNote(notesById[id], book))
    const result = await manager.markQuestionsAsMistakes(cards as any, book, 1)
    assert.equal(result.added, 1)
    assert.equal(result.updated, 1)
    assert.equal(result.failed, 1)
    assert.equal(result.records.length, 2)
    const saved = mistakeStateRecords()
    assert.equal(saved[goodId].history.length, 1)
    assert.equal(saved[goodId].history[0].level, 1)
    assert.ok(saved[goodId].lastReviewedAt)
    assert.deepEqual(saved[badId], beforeBad)
    assert.ok(saved[`${book}:${newNote}`])
    assert.ok(tagsOf(notesById[newNote]).includes("用户标签"))
    assert.equal(undoCalls.length - beforeUndo, 1)
    assert.equal(undoCalls[undoCalls.length - 1]?.notebookId, book)
    assert.equal(refreshed[refreshed.length - 1], book)
    assert.equal(syncDirty[syncDirty.length - 1], book)
  } finally { noWriteNotes.delete(badNote) }
})

test("批量标记全部写入失败时不创建记录；无效卡片计失败，重复项不重复计数", async () => {
  await loadModules()
  const book = `batchFailure${seq++}`, note = `${book}-new`
  notesById[note] = { noteId: note, title: "未写入题目", comments: [] }
  noWriteNotes.add(note)
  try {
    const card = new FakeNodeNote(notesById[note], book)
    const result = await manager.markQuestionsAsMistakes([card, card, new FakeNodeNote({}, book)] as any, book, 0)
    assert.equal(result.added, 0)
    assert.equal(result.updated, 0)
    assert.equal(result.failed, 2)
    assert.deepEqual(result.records, [])
    assert.equal(mistakeStateRecords()[`${book}:${note}`], undefined)
  } finally { noWriteNotes.delete(note) }
})

test("显式列表刷新同步全部原卡标题标签与缺失状态，不写原卡、不增加复习次数", async () => {
  const book = `refresh${seq++}`
  const liveId = await seedRecord(book, `${book}-live`, 0)
  const missingId = await seedRecord(book, `${book}-missing`, 0)
  const live = notesById[`${book}-live`]
  live.title = "修改后的题名"
  setTagsOf(live, ["错题_不会", "很长的用户标签"])
  delete notesById[`${book}-missing`]
  manager.mistakeWorkbenchData() // Warm the cached list before refreshing.
  const writes = undoCalls.length
  await manager.refreshMistakeList()
  const records = manager.mistakeWorkbenchData().records
  assert.equal(records.find(r => r.recordId === liveId)?.sourceTitle, "修改后的题名")
  assert.deepEqual(records.find(r => r.recordId === liveId)?.manualCategories, ["很长的用户标签"])
  assert.equal(records.find(r => r.recordId === liveId)?.reviewCount, 0)
  assert.equal(records.find(r => r.recordId === missingId)?.noteAvailable, false)
  assert.equal(undoCalls.length, writes)
  notesById[`${book}-missing`] = { noteId: `${book}-missing`, title: "恢复原卡", comments: [{ type: "TextNote", text: "#错题_不会" }] }
  await manager.refreshMistakeList()
  assert.equal(manager.mistakeWorkbenchData().records.find(r => r.recordId === missingId)?.noteAvailable, true)
})

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

test("首次打开子脑图题目直接取卡，移动后详情同步新脑图且不扫描学习集", async () => {
  const notebookId = `nbDirect${seq++}`
  const noteId = `${notebookId}-note`
  const id = await seedRecord(notebookId, noteId, 0)
  notesById[noteId].childMindMap = { noteId: "first-root" }
  forbiddenNotebookScans.add(notebookId)
  try {
    const first = manager.mistakeDetailById(id, "question")
    assert.equal(first.record.sourceRootNodeId, "first-root")
    assert.ok(first.questionHtml)
    assert.equal(first.answerStatus, "deferred")
    notesById[noteId].childMindMap = { noteId: "moved-root" }
    const moved = manager.mistakeDetailById(id, "question")
    assert.equal(moved.record.sourceRootNodeId, "moved-root")
    assert.equal(mistakeStateRecords()[id].sourceRootNodeId, "moved-root")
  } finally { forbiddenNotebookScans.delete(notebookId) }
})

test("错题详情将带错误码的索引未建立识别为可恢复状态，读取原题不触发该查询", async () => {
  const notebookId = `nbIndexMissing${seq++}`
  const noteId = `${notebookId}-note`
  const id = await seedRecord(notebookId, noteId, 0)
  const state = store.loadMistakeState()
  store.upsertMistakeRecord(state, { ...state.records[id], answerNotebookId: `${notebookId}-answers` })
  store.saveMistakeState(state)
  assert.equal(manager.mistakeDetailById(id, "question").answerStatus, "deferred")
  assert.equal(manager.mistakeDetailById(id, "answers").answerStatus, "index-missing")
})

test("详情可先读原题并延后答案；答案请求不再次读取原题笔迹", async () => {
  const notebookId = `nbDeferred${seq++}`
  const noteId = `${notebookId}-note`
  const id = await seedRecord(notebookId, noteId, 0)
  const db = marginnoteMock.MN.db as any
  let handwritingReads = 0
  db.getSketchNoteForMindMapFocusNoteId = () => { handwritingReads++; return null }
  try {
    notesById[noteId].title = "按需详情"
    const question = manager.mistakeDetailById(id, "question")
    assert.equal(question.answerStatus, "deferred")
    assert.deepEqual(question.answers, [])
    assert.ok(question.questionHtml)
    assert.equal(question.record.sourceTitle, "按需详情")
    assert.equal(handwritingReads, 1)
    const answers = manager.mistakeDetailById(id, "answers")
    assert.equal(answers.questionHtml, "")
    assert.notEqual(answers.answerStatus, "deferred")
    assert.equal(handwritingReads, 1)
    const full = manager.mistakeDetailById(id)
    assert.ok(full.questionHtml)
    assert.notEqual(full.answerStatus, "deferred")
    assert.equal(handwritingReads, 2)
  } finally { delete db.getSketchNoteForMindMapFocusNoteId }
})

test("原题详情按 ID 读取跨学习集链接，并只为已收录的目标返回错题 ID", async () => {
  const notebookId = `nbLinks${seq++}`
  const otherNotebookId = `${notebookId}-other`
  const noteId = `${notebookId}-source`
  const linkedId = `${notebookId}-linked`
  const externalId = `${notebookId}-external`
  const id = await seedRecord(notebookId, noteId, 0)
  const linkedRecordId = await seedRecord(otherNotebookId, linkedId, 0)
  notesById[linkedId].notebookId = otherNotebookId
  notesById[linkedId].noteTitle = "实时链接题名"
  notesById[externalId] = { noteId: externalId, notebookId, noteTitle: "未收录题目" }
  notesById[noteId].linkedNotes = [{ noteid: linkedId }, { noteid: "missing" }, { noteid: noteId }]
  notesById[noteId].comments.push({ type: "TextNote", text: `marginnote4app://note/${externalId}` })

  const result = manager.mistakeDetailById(id, "question")
  assert.deepEqual(result.linkedQuestions, [
    { noteId: linkedId, title: "实时链接题名", recordId: linkedRecordId },
    { noteId: externalId, title: "未收录题目", recordId: undefined },
  ])
  assert.equal(manager.mistakeDetailById(id, "answers").linkedQuestions, undefined)
  assert.equal(manager.mistakeDetailById(id, "question", true).linkedQuestions, undefined)
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

  await assert.rejects(() => manager.reviewMistakeById(recordId, 1), (error: any) => error?.code === "mistakeTagWriteFailed")
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

  await assert.rejects(() => manager.reviewMistakeById(recordId, 1), (error: any) => error?.code === "mistakeTagWriteFailed")
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

  await assert.rejects(() => manager.reviewMistakeById(recordId, 1), (error: any) => error?.code === "mistakeTagRemoved")
  assert.ok(!mistakeStateRecords()[recordId], "取消的记录必须从库中删除")
})

test("未写过标签的旧记录：无托管标签也不能通过复习复活，历史先归档", async () => {
  await loadModules()
  const notebookId = `nbL${seq}`
  const recordId = await seedRecord(notebookId, `nL${seq}`, 2, { tagsWrittenAt: false, cardTags: [] })
  seq++
  ;(marginnoteMock.MN as any).currnetNotebookId = notebookId

  await assert.rejects(() => manager.reviewMistakeById(recordId, 2), (error: any) => error?.code === "mistakeTagRemoved")
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

test("标签恢复复用已取得的学习集卡片，不为识别子脑图根重复读取列表", async () => {
  await loadModules()
  const notebookId = `nbRecoveryDirect${seq++}`
  const rootId = `${notebookId}-root`
  notesById[rootId] = { noteId: rootId, title: "恢复根题", comments: [{ type: "TextNote", text: "#错题_不会" }] }
  const child = { noteId: `${rootId}-child`, parentNote: notesById[rootId], childMindMap: notesById[rootId], comments: [] }
  let reads = 0
  const notebook = { topicId: notebookId, title: "恢复学习集", flags: 2, get notes() { reads++; return [notesById[rootId], child] } }
  const db = marginnoteMock.MN.db as any
  const previous = db.allNotebooks
  db.allNotebooks = () => [notebook]
  try {
    const result = await manager.recoverMistakesFromTags()
    assert.equal(result.added, 1)
    assert.equal(result.failed, 0)
    assert.equal(mistakeStateRecords()[`${notebookId}:${rootId}`].sourceRootNodeId, rootId)
    assert.equal(reads, 1)
  } finally { db.allNotebooks = previous }
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

test("FSRS 开启时拒绝固定间隔保存，关闭调试后恢复，原参数不受影响", async () => {
  await loadModules()
  const settings = await import("../src/settings")
  const before = settings.loadMatcherSettings()
  try {
    settings.saveMatcherSettings({ debugModeEnabled: true, debugReviewAlgorithm: "fsrs" })
    assert.throws(() => manager.saveMistakeReviewCurves([[9], [9], [9]]), /智能复习/)
    assert.deepEqual(settings.loadMatcherSettings().mistakeReviewCurves, before.mistakeReviewCurves)
    settings.saveMatcherSettings({ debugModeEnabled: false })
    manager.saveMistakeReviewCurves(before.mistakeReviewCurves)
    assert.deepEqual(settings.loadMatcherSettings().mistakeReviewCurves, before.mistakeReviewCurves)
  } finally { settings.saveMatcherSettings(before) }
})
