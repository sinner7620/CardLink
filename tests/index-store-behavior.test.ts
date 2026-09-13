/**
 * 索引快照存储行为测试：mock marginnote 运行时，验证——
 * 1. 快照优先读写 Application.cachePath 文件；
 * 2. 旧 NSUserDefaults 快照读到后自动迁移到文件并清空旧键；
 * 3. cachePath 不可用时回退旧存储（快照不丢）。
 */
import { test, mock } from "node:test"
import assert from "node:assert/strict"

const files = new Map<string, string>()
const kv: Record<string, unknown> = {}

let cachePathValue: string | undefined = "/cache"
let writesDisabled = false
const writes: Array<{ path: string; text: string }> = []
const directories = new Set<string>()

;(globalThis as any).NSFileManager = {
  defaultManager: () => ({
    fileExistsAtPath: (path: string) => files.has(path) || directories.has(path),
    createDirectoryAtPathWithIntermediateDirectoriesAttributes: (path: string) => { directories.add(path); return true },
    copyItemAtPathToPath: (source: string, destination: string) => {
      const value = files.get(source)
      if (value !== undefined) files.set(destination, value)
    },
    removeItemAtPath: (path: string) => { files.delete(path); directories.delete(path) }
  })
}

const marginnoteMock = {
  isfileExists: (path: string) => files.has(path),
  readJSON: (path: string) => {
    const raw = files.get(path)
    return raw === undefined ? undefined : JSON.parse(raw)
  },
  writeTextFile: (path: string, text: string) => {
    if (writesDisabled) return
    writes.push({ path, text })
    files.set(path, text)
  },
  getLocalDataByKey: (key: string) => kv[key],
  setLocalDataByKey: (value: unknown, key: string) => { kv[key] = value },
  MN: { app: { get cachePath() { return cachePathValue } } }
}

mock.module("marginnote", { namedExports: marginnoteMock })

type Store = typeof import("../src/index-store")
let store: Store
async function loadStore() {
  if (!store) store = await import("../src/index-store")
}

const NOTEBOOK = "nbABC-123"
const FILE = `/cache/CardLink/indexes/mn4-answer-matcher.index.v1.${NOTEBOOK}.json`
const LEGACY_FILE = `/cache/mn4-answer-matcher.index.v1.${NOTEBOOK}.json`
const LEGACY_KEY = `mn4-answer-matcher.index.v1.${NOTEBOOK}`
const items = [
  { id: "a1", noteId: "n1", notebookId: NOTEBOOK, pathTitles: [], titles: ["题1"], tags: [], comments: [], excerpts: [], children: [] }
]

test("快照优先落 cachePath 文件，并清空旧 NSUserDefaults 键", async () => {
  await loadStore()
  store.saveStoredIndex(NOTEBOOK, items as any)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, FILE)
  assert.equal(JSON.parse(files.get(FILE)!).length, 1)
  assert.equal(kv[LEGACY_KEY], "", "旧键应被清空以瘦身配置存储")
  const loaded = store.loadStoredIndex(NOTEBOOK)
  assert.equal(loaded?.length, 1)
  assert.equal(loaded![0].noteId, "n1")
})

test("旧 NSUserDefaults 快照读到后自动迁移到文件", async () => {
  await loadStore()
  // 模拟升级场景：文件不存在、旧键有数据
  files.clear()
  writes.length = 0
  kv[LEGACY_KEY] = items
  const loaded = store.loadStoredIndex(NOTEBOOK)
  assert.equal(loaded?.length, 1)
  assert.ok(writes.some(w => w.path === FILE), "应把旧快照迁移写入文件")
  assert.equal(kv[LEGACY_KEY], "", "迁移后旧键应被清空")
})

test("根 cachePath 的旧索引文件迁移到 CardLink/indexes", async () => {
  await loadStore()
  files.clear()
  writes.length = 0
  files.set(LEGACY_FILE, JSON.stringify(items))
  const loaded = store.loadStoredIndex(NOTEBOOK)
  assert.equal(loaded?.[0]?.noteId, "n1")
  assert.equal(files.has(FILE), true)
  assert.equal(files.has(LEGACY_FILE), false)
})

test("cachePath 不可用时回退旧存储，快照不丢", async () => {
  await loadStore()
  cachePathValue = undefined
  files.clear()
  writes.length = 0
  store.saveStoredIndex(NOTEBOOK, items as any)
  assert.equal(writes.length, 0)
  assert.equal(Array.isArray(kv[LEGACY_KEY]), true)
  const loaded = store.loadStoredIndex(NOTEBOOK)
  assert.equal(loaded?.length, 1)
  cachePathValue = "/cache"
})

test("快照文件损坏时回退旧存储且不崩溃", async () => {
  await loadStore()
  cachePathValue = "/cache"
  files.set(FILE, "{corrupt json")
  kv[LEGACY_KEY] = items
  const loaded = store.loadStoredIndex(NOTEBOOK)
  assert.equal(loaded?.length, 1, "损坏文件应回退旧 NSUserDefaults 快照")
})

test("空索引快照读写保留“已建立但 0 张卡”语义", async () => {
  await loadStore()
  cachePathValue = "/cache"
  files.clear(); writes.length = 0
  delete kv[LEGACY_KEY]
  store.saveStoredIndex(NOTEBOOK, [])
  assert.equal(JSON.parse(files.get(FILE)!).length, 0)
  // 空数组必须被读回（而不是视为无快照），否则空答案范围每次查找都误报“索引尚未建立”
  assert.deepEqual(store.loadStoredIndex(NOTEBOOK), [])
})
