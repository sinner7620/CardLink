import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { createSourceFile, isFunctionDeclaration, ScriptTarget, transpileModule } from "typescript"

function moduleAt(file: string, modules: Record<string, any>) {
  const context = { exports: {} as any, require: (name: string) => modules[name] ?? {} }
  runInNewContext(transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  return context.exports
}

function storage() {
  const data = new Map<string, any>()
  return { data, getLocalDataByKey: (key: string) => data.get(key), setLocalDataByKey: (value: any, key: string) => data.set(key, JSON.parse(JSON.stringify(value))) }
}

function functionAt(file: string, name: string, globals: Record<string, any>) {
  const source = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest, true)
  const declaration = source.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === name)
  assert.ok(declaration, `${name} 应存在`)
  const context = { exports: {} as any, ...globals }
  runInNewContext(transpileModule(declaration.getText(source), { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  return context.exports[name]
}

function snapshot(value: any) {
  return JSON.parse(JSON.stringify(value))
}

test("复习完成彩纸默认开启，旧设置缺少字段时保留其他偏好，开关可保存并重启恢复", () => {
  const store = storage()
  const modules = { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: (value: any) => value ?? {} } }
  const load = () => moduleAt("src/settings.ts", modules)
  let api = load()
  assert.equal(api.loadMatcherSettings().reviewCompletionConfetti, true)
  api.saveMatcherSettings({ mistakeListDisplay: "autoHide", entranceDefaultMode: "clipper", reviewExpandedCommentCount: 5, globalQuestionColors: [1, 3] })
  const expected = snapshot(api.loadMatcherSettings())
  for (const value of store.data.values()) delete value.reviewCompletionConfetti
  api = load()
  assert.deepEqual(snapshot(api.loadMatcherSettings()), expected, "缺少旧字段仍默认开启，不重置其他设置")

  for (const enabled of [false, true]) {
    api.saveMatcherSettings({ reviewCompletionConfetti: enabled })
    assert.deepEqual(snapshot(api.loadMatcherSettings()), { ...expected, reviewCompletionConfetti: enabled })
    api = load()
    assert.deepEqual(snapshot(api.loadMatcherSettings()), { ...expected, reviewCompletionConfetti: enabled }, "重启后保留开关及其他偏好")
    api.saveMatcherSettings({ reviewExpandedCommentCount: 6 })
    api = load()
    assert.equal(api.loadMatcherSettings().reviewCompletionConfetti, enabled, "保存其他偏好不能覆盖开关")
    api.saveMatcherSettings({ reviewExpandedCommentCount: 5 })
  }
})

test("复习完成彩纸保存非法值时保留当前开关及其他设置", () => {
  const store = storage()
  const modules = { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: (value: any) => value ?? {} } }
  const load = () => moduleAt("src/settings.ts", modules)
  let api = load()
  api.saveMatcherSettings({ boundHandwritingDisplay: "always", autoCollapseComments: true, answerMaskColor: "#123456" })
  for (const enabled of [false, true]) {
    api.saveMatcherSettings({ reviewCompletionConfetti: enabled })
    const expected = snapshot(api.loadMatcherSettings())
    for (const invalid of ["false", "true", 0, 1, null, undefined, [], {}, new Boolean(false)]) {
      api.saveMatcherSettings({ reviewCompletionConfetti: invalid })
      assert.deepEqual(snapshot(api.loadMatcherSettings()), expected, `非法值 ${String(invalid)} 不覆盖当前设置`)
      api = load()
      assert.deepEqual(snapshot(api.loadMatcherSettings()), expected, "重启后仍保留当前设置")
    }
  }
})

test("原生个性设置命令仅接受布尔彩纸开关，匹配设置快照包含当前开关", async () => {
  const store = storage()
  const modules = { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: (value: any) => value ?? {} } }
  const load = () => moduleAt("src/settings.ts", modules)
  let api = load()
  api.saveMatcherSettings({ entranceDefaultMode: "clipper", reviewExpandedCommentCount: 4 })
  const expected = snapshot(api.loadMatcherSettings())
  const matching = functionAt("src/plugin.ts", "answerMatchingSettingsData", {
    loadMatcherSettings: () => api.loadMatcherSettings(),
    currentNotebookId: () => undefined,
    loadBindings: () => ({}),
    matchingModeLabel: () => "完整标题匹配"
  })
  const writes: any[] = []
  const nativeModules: Record<string, any> = {
    "./settings": {
      loadMatcherSettings: () => api.loadMatcherSettings(),
      saveMatcherSettings: (value: any) => { writes.push(snapshot(value)); api.saveMatcherSettings(value) }
    },
    "./plugin": { answerMatchingSettingsData: matching, managedAnswerBindings: () => [] },
    "./question-clipper": { clipperSnapshot: () => ({}) },
    "./note-navigation": { captureDiagnosticError() {} },
    "./error-messages": { presentError: (error: any) => error }
  }
  const context: any = { exports: {}, self: {}, require: (name: string) => nativeModules[name] ?? {} }
  runInNewContext(transpileModule(readFileSync("src/rails-core.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  const bridge = context.__MN_ANSWER_CORE_GLOBAL__.bridge
  assert.equal(matching().reviewCompletionConfetti, true)
  assert.equal((await bridge("bindingSettingsSnapshot", {})).matching.reviewCompletionConfetti, true)

  for (const enabled of [false, true]) {
    const result = await bridge("setPersonalSetting", { key: "reviewCompletionConfetti", value: enabled })
    assert.deepEqual(writes[writes.length - 1], { reviewCompletionConfetti: enabled }, "原生命令只保存指定开关")
    assert.equal(result.reviewCompletionConfetti, enabled, "命令响应包含更新后的开关")
    assert.equal(result.entranceDefaultMode, "clipper")
    assert.equal(result.reviewExpandedCommentCount, 4)
    api = load()
    assert.deepEqual(snapshot(api.loadMatcherSettings()), { ...expected, reviewCompletionConfetti: enabled })
    assert.equal((await bridge("bindingSettingsSnapshot", {})).matching.reviewCompletionConfetti, enabled)
    const writeCount = writes.length
    for (const invalid of ["false", "true", 0, 1, null, undefined, [], {}, new Boolean(false)]) {
      await assert.rejects(bridge("setPersonalSetting", { key: "reviewCompletionConfetti", value: invalid }))
      assert.equal(writes.length, writeCount, "非法载荷必须在原生分发层拒绝，不能依赖存储层规范化")
      api = load()
      assert.deepEqual(snapshot(api.loadMatcherSettings()), { ...expected, reviewCompletionConfetti: enabled })
      assert.equal(matching().reviewCompletionConfetti, enabled)
    }
  }
  assert.deepEqual(writes, [{ reviewCompletionConfetti: false }, { reviewCompletionConfetti: true }])
})

test("答案缩放模式默认插件、可持久化原生选择，非法值不覆盖", () => {
  const store = storage()
  const modules = { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: () => ({}) } }
  let api = moduleAt("src/settings.ts", modules)
  assert.equal(api.loadMatcherSettings().debugAnswerPreviewMode, "custom")
  api.saveMatcherSettings({ debugModeEnabled: true, debugAnswerPreviewMode: "native" })
  api = moduleAt("src/settings.ts", modules)
  assert.equal(api.loadMatcherSettings().debugAnswerPreviewMode, "native")
  api.saveMatcherSettings({ debugAnswerPreviewMode: "bad" })
  assert.equal(api.loadMatcherSettings().debugAnswerPreviewMode, "native")
  api.saveMatcherSettings({ debugModeEnabled: false })
  assert.equal(api.loadMatcherSettings().debugModeEnabled, false)
  assert.equal(api.loadMatcherSettings().debugAnswerPreviewMode, "native", "保留选择，是否启用由调试开关控制")
})

test("多答案记住最后选择；重启、索引重排、题目和学习集隔离及失效回退", () => {
  const store = storage()
  const load = () => moduleAt("src/answer-preference.ts", { marginnote: store })
  let api = load()
  const a = { notebookId: "answers", noteId: "a", id: "node-a" }
  const b = { notebookId: "answers", noteId: "b", id: "node-b" }
  const candidates = [a, b]
  assert.equal(api.preferredAnswer("source", "q", candidates), a)
  api.rememberAnswer("source", "q", a)
  api.rememberAnswer("source", "q", b)
  api = load()
  assert.equal(api.preferredAnswer("source", "q", candidates), b)
  assert.deepEqual(candidates, [a, b], "不改变候选序号")
  assert.equal(api.preferredAnswer("source", "q", [b, a]), b)
  assert.equal(api.preferredAnswer("source", "other", candidates), a)
  assert.equal(api.preferredAnswer("other", "q", candidates), a)
  assert.equal(api.preferredAnswer("source", "q", [a]), a)
  assert.equal(api.preferredAnswer("source", "q", []), undefined)
  assert.equal(api.preferredAnswer("source", "q", [{ ...b, id: "new-node" }]).id, "new-node")
})

test("旧设置保留双击手写和固定列表；两项设置持久化且互不覆盖", () => {
  const store = storage()
  const modules = { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: (value: any) => value ?? {} } }
  let api = moduleAt("src/settings.ts", modules)
  assert.equal(api.loadMatcherSettings().boundHandwritingDisplay, "doubleTap")
  assert.equal(api.loadMatcherSettings().mistakeListDisplay, "always")
  assert.equal(api.loadMatcherSettings().entranceDefaultMode, "practice")
  api.saveMatcherSettings({ entranceDefaultMode: "clipper" })
  assert.equal(api.loadMatcherSettings().entranceDefaultMode, "clipper")
  api.saveMatcherSettings({ entranceDefaultMode: "invalid" })
  assert.equal(api.loadMatcherSettings().entranceDefaultMode, "clipper")
  const reloaded = moduleAt("src/settings.ts", { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: () => [] } })
  assert.equal(reloaded.loadMatcherSettings().entranceDefaultMode, "clipper")
  api.saveMatcherSettings({ boundHandwritingDisplay: "always" })
  api.saveMatcherSettings({ mistakeListDisplay: "autoHide" })
  api = moduleAt("src/settings.ts", modules)
  assert.equal(api.loadMatcherSettings().boundHandwritingDisplay, "always")
  assert.equal(api.loadMatcherSettings().mistakeListDisplay, "autoHide")
  api.saveMatcherSettings({ boundHandwritingDisplay: "invalid", mistakeListDisplay: "invalid" })
  assert.equal(api.loadMatcherSettings().boundHandwritingDisplay, "always")
  assert.equal(api.loadMatcherSettings().mistakeListDisplay, "autoHide")
})

test("绑定手写显示设置只影响交互预览，不改变 AI/导出内容", () => {
  let mode = "doubleTap"
  const api = moduleAt("src/bound-handwriting.ts", { "./settings": { loadMatcherSettings: () => ({ boundHandwritingDisplay: mode }) } })
  const result = { status: "included", assets: [{ hash: "ink", kind: "image", mime: "image/png", base64: "AAAA" }] }
  const render = (interactive = true) => api.appendBoundMindMapHandwriting("<body><article></article></body>", result, interactive)
  const staticHtml = render(false)
  assert.match(render(), /data-bound-handwriting hidden/)
  mode = "always"
  assert.match(render(), /data-bound-handwriting="always"/)
  assert.doesNotMatch(render(), /data-bound-handwriting hidden/)
  assert.equal(render(false), staticHtml)
})

test("答案窗口恢复已选序号，保留全部候选，切题不会把旧选择写给新题", async () => {
  const store = storage()
  const prefs = moduleAt("src/answer-preference.ts", { marginnote: store })
  const source = readFileSync("src/plugin.ts", "utf8")
  const show = source.slice(source.indexOf("let answerQuestion:"), source.indexOf("async function openAnswerEditor"))
  const choose = source.slice(source.indexOf("export async function onChooseAnswerCandidate"), source.indexOf("/** 插件使用说明网页入口"))
  const find = source.slice(source.indexOf("export async function findCurrentAnswer"), source.indexOf("async function runSafely"))
  const a = { notebookId: "answers", noteId: "a", id: "a", titles: ["A"], tags: ["标准答案"], pathTitles: ["匹配路径"] }
  const b = { ...a, noteId: "b", id: "b", titles: ["B"], tags: [], pathTitles: [] }
  let questionId = "q1", selected = 1, ordinal = -1, chooserResolve: any
  let pending = false
  const addon: any = { answerCardView: { hidden: false } }
  const context: any = {
    exports: {}, self: addon, ...prefs,
    resolveAnswerLookupContext: () => ({ questionNotebookId: "source", sourceNotebookId: "source", questionTitle: questionId,
      lookupQuestion: { note: { noteId: questionId } }, answerTarget: { notebookId: "answers" }, titles: [], path: [] }),
    recordRuntimeState() {}, recordAnswerCardDiagnostics() {},
    findAnswersForQuestion: () => [a, b], distinctAnswers: (items: any) => items, excludeAnswerNoteId: (items: any) => items,
    answerCardHtml: (answer: any) => answer.noteId,
    showAnswerCard: () => { addon.answerCardView.hidden = false },
    syncAnswerCandidatesControl: (items: any[], index: number) => { assert.equal(items.length, 2); ordinal = index },
    answerText: () => "", runSafely: (fn: any) => fn(),
    select: () => pending ? new Promise(resolve => { chooserResolve = resolve }) : Promise.resolve({ index: selected })
  }
  runInNewContext(transpileModule(show + choose + find, { compilerOptions: { module: 1, target: 7 } }).outputText, context)
  await context.exports.findCurrentAnswer()
  assert.equal(ordinal, 0)
  await context.exports.onChooseAnswerCandidate()
  assert.equal(ordinal, 1)
  addon.answerCardView.hidden = true
  await context.exports.findCurrentAnswer()
  assert.equal(ordinal, 1)
  pending = true
  const oldChooser = context.exports.onChooseAnswerCandidate()
  questionId = "q2"
  await context.exports.findCurrentAnswer()
  chooserResolve({ index: 1 })
  await oldChooser
  assert.equal(addon.answerCardAnswerNoteId, "a")
  assert.equal(prefs.preferredAnswer("source", "q2", [a, b]), a)
  questionId = "q1"
  await context.exports.findCurrentAnswer()
  assert.equal(ordinal, 1)
})


test("忽略旧场景开关并保留其他个人设置", () => {
  const store = storage()
  const modules = { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: (v: any) => v ?? {} } }
  let api = moduleAt("src/settings.ts", modules)
  api.saveMatcherSettings({ sceneWorkbenchEnabled: true, mistakeListDisplay: "autoHide" })
  api = moduleAt("src/settings.ts", modules)
  assert.equal("sceneWorkbenchEnabled" in api.loadMatcherSettings(), false)
  assert.equal(api.loadMatcherSettings().mistakeListDisplay, "autoHide")
})


test("自动安装设置默认关闭，随调试模式关闭清除，重开不自动恢复", () => {
  const store = storage()
  const modules = { marginnote: store, "./mistake-review-settings": { normalizeMistakeReviewCurves: () => [] } }
  let api = moduleAt("src/settings.ts", modules)
  assert.equal(api.loadMatcherSettings().debugAutoInstallUpdatesEnabled, false)
  api.saveMatcherSettings({ debugAutoInstallUpdatesEnabled: true })
  assert.equal(api.loadMatcherSettings().debugAutoInstallUpdatesEnabled, false)
  api.saveMatcherSettings({ debugModeEnabled: true, debugAutoInstallUpdatesEnabled: true })
  api = moduleAt("src/settings.ts", modules)
  assert.equal(api.loadMatcherSettings().debugAutoInstallUpdatesEnabled, true)
  api.saveMatcherSettings({ debugModeEnabled: false })
  api.saveMatcherSettings({ debugModeEnabled: true })
  assert.equal(api.loadMatcherSettings().debugAutoInstallUpdatesEnabled, false)
})

test('全局题目颜色规范化、持久化并与所有绑定局部颜色合并', () => {
  const disk = storage()
  const settings = moduleAt('src/settings.ts', { marginnote: disk, './mistake-review-settings': { normalizeMistakeReviewCurves: () => ({}) } })
  settings.saveMatcherSettings({ globalQuestionColors: [1, 1, 3, -1, 50, '2'] })
  assert.deepEqual(Array.from(settings.loadMatcherSettings().globalQuestionColors), [1, 3])
  const binding = moduleAt('src/binding.ts', {})
  const store = moduleAt('src/store.ts', { marginnote: disk, './binding': binding, './settings': settings })
  const explicit = { notebookId: 'answers', questionColors: [4] }
  assert.deepEqual(Array.from(store.getBindingForMode({ book: explicit }, 'book', undefined, true).questionColors), [1, 3, 4])
  assert.deepEqual(Array.from(store.getBindingForMode({ book: { notebookId: 'answers' } }, 'book', undefined, true).questionColors), [1, 3])
  assert.equal(explicit.questionColors.length, 1)
  settings.saveMatcherSettings({ globalQuestionColors: [] })
  assert.equal(store.getBindingForMode({ book: { notebookId: 'answers' } }, 'book', undefined, true).questionColors, undefined)
})
