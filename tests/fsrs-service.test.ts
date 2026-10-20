import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { transpileModule } from "typescript"
import * as domain from "../src/fsrs-domain"
import * as storage from "../src/fsrs-store"
import { createMistakeRecord } from "../src/mistake-domain"

function harness() {
  const settings: any = { debugModeEnabled: false, debugReviewAlgorithm: "fixed" }
  const fixed = { records: { "book:note": createMistakeRecord({ sourceNoteId: "note", sourceNotebookId: "book", sourceNotebookTitle: "书", sourceTitle: "题", sourcePathTitles: [], level: 1 }, new Date("2026-10-01")) } }
  const kv: Record<string, unknown> = {}, backup: Record<string, unknown> = {}, access: string[] = []
  const service: any = {}
  const modules: any = {
    "./fsrs-domain": domain, "./fsrs-store": storage,
    "./settings": { loadMatcherSettings: () => settings },
    "./mistake-store": { loadMistakeState: () => fixed },
    "./mistake-manager": { isolatedReviewContent: () => ({ questionHtml: "q", answers: [] }) },
    "./storage-paths": { cardLinkDocumentPath: () => "/backups", ensureStorageDirectory() {} },
    marginnote: { MN: { app: { documentPath: "/docs" } }, getLocalDataByKey: (key: string) => { access.push(`read:${key}`); return kv[key] },
      setLocalDataByKey: (value: unknown, key: string) => { access.push(`write:${key}`); kv[key] = value },
      isfileExists: (path: string) => !!backup[path], readJSON: (path: string) => backup[path], writeTextFile: (path: string, value: unknown) => { backup[path] = value } }
  }
  runInNewContext(transpileModule(readFileSync("src/fsrs-service.ts", "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText,
    { exports: service, require: (name: string) => modules[name] })
  return { settings, fixed, kv, access, service }
}
test("调试关闭和固定模式下 FSRS 命令零存储读写", () => {
  const h = harness()
  assert.deepEqual(h.access, [])
  for (const command of ["fsrsSnapshot", "fsrsReview", "fsrsSaveOptions", "fsrsPause", "fsrsAmendErrors"]) {
    assert.throws(() => h.service.fsrsCommand(command, {}), /调试模式/)
  }
  assert.throws(() => h.service.initializeFsrs(), /调试模式/)
  h.settings.debugModeEnabled = true
  assert.throws(() => h.service.fsrsSnapshot(), /调试模式/)
  assert.deepEqual(h.access, [])
})
test("初始化、评分、暂停、切换及错因补改都不写固定数据，重复切换不重新迁入", () => {
  const h = harness(), fixedBefore = JSON.stringify(h.fixed)
  h.settings.debugModeEnabled = true
  h.service.initializeFsrs()
  h.settings.debugReviewAlgorithm = "fsrs"
  let result = h.service.fsrsCommand("fsrsReview", { recordId: "book:note", eventId: "event-1", revision: 0, rating: 4 })
  assert.equal(result.card.reps, 1)
  h.service.fsrsCommand("fsrsPause", { recordId: "book:note", revision: 1, paused: true })
  const saved = h.kv[storage.FSRS_STORAGE_KEY]
  h.settings.debugModeEnabled = false
  assert.throws(() => h.service.fsrsCommand("fsrsReview", {}))
  assert.equal(h.kv[storage.FSRS_STORAGE_KEY], saved)
  h.settings.debugModeEnabled = true
  h.service.initializeFsrs()
  assert.equal(h.kv[storage.FSRS_STORAGE_KEY], saved)
  result = h.service.fsrsCommand("fsrsAmendErrors", { recordId: "book:note", revision: 2, eventId: "event-1", errorReasons: ["time"], errorNote: "耗时较长" })
  assert.equal(result.card.reps, 1)
  assert.equal(JSON.stringify(h.fixed), fixedBefore)
  assert.ok(h.access.every(key => key.endsWith(storage.FSRS_STORAGE_KEY)))
})

test("桥接门闸关闭时不加载 FSRS 模块；切换只初始化独立库；复习中禁止切换", async () => {
  const settings: any = { debugModeEnabled: false, debugReviewAlgorithm: "fixed" }
  let imports = 0, initialized = 0
  const owner: any = {}, api: any = {}
  const source = readFileSync("src/rails-core.ts", "utf8")
  const body = source.match(/async function bridgeInternal[\s\S]*?^}/m)![0]
  assert.ok(body.includes("async function bridgeInternal"))
  runInNewContext(transpileModule(body + "\nexports.invoke = bridgeInternal", { compilerOptions: { module: 1, target: 7 } }).outputText, {
    exports: api, self: owner, loadMatcherSettings: () => settings, isAICommand: () => false,
    saveMatcherSettings: (patch: any) => Object.assign(settings, patch), CardLinkError: Error,
    require: () => { imports++; return { initializeFsrs: () => initialized++, fsrsCommand: () => ({ ok: true }) } }
  })
  for (const command of ["fsrsSnapshot", "fsrsReview", "setReviewAlgorithm", "startFsrsReviewMode"]) await assert.rejects(api.invoke(command, { algorithm: "fsrs" }, owner))
  assert.equal(imports, 0)
  settings.debugModeEnabled = true
  await api.invoke("setReviewAlgorithm", { algorithm: "fsrs" }, owner)
  assert.equal(initialized, 1)
  assert.equal(settings.debugReviewAlgorithm, "fsrs")
  owner.cardLinkReviewMode = { algorithm: "fsrs" }
  await assert.rejects(api.invoke("setReviewAlgorithm", { algorithm: "fixed" }, owner), /退出/)
  await assert.rejects(api.invoke("setDebugMode", { enabled: false }, owner), /退出/)
  delete owner.cardLinkReviewMode
  await api.invoke("setReviewAlgorithm", { algorithm: "fixed" }, owner)
  const count = imports
  await assert.rejects(api.invoke("fsrsReview", {}, owner))
  assert.equal(imports, count)
})
