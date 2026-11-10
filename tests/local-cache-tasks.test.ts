import test, { mock } from "node:test"
import assert from "node:assert/strict"

mock.module("marginnote", { namedExports: { MN: { app: { cachePath: "/cache", tempPath: "/tmp", documentPath: "/docs" } } } })
const callbacks: Array<() => void> = []
;(globalThis as any).NSTimer = { scheduledTimerWithTimeInterval(_seconds: number, _repeat: boolean, callback: () => void) { callbacks.push(callback); return {} } }
let reads = 0, preferredCalls = 0, legacyCalls = 0, failure = "", unsupported = false
const files = new Set<string>(), dirs = new Set<string>()
const manager: any = {
  fileExistsAtPath: (path: string) => dirs.has(path) || files.has(path),
  isDirectoryAtPath: (path: string) => dirs.has(path),
  contentsOfDirectoryAtPath(path: string) { reads++; return [...dirs, ...files].filter(p => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/")).map(p => p.slice(path.length + 1)) },
  attributesOfItemAtPath: () => ({ NSFileSize: 100 }),
  createDirectoryAtPathWithIntermediateDirectoriesAttributes(path: string) { while (path) { dirs.add(path); path = path.slice(0, path.lastIndexOf("/")) } },
  moveItemAtPathToPath(path: string, target: string) { preferredCalls++; if (failure === "throw") throw Error("permission denied"); if (!failure) { files.delete(path); files.add(target) }; return !failure },
  removeItemAtPath() { legacyCalls++; throw Error("must not delete") }

}
;(globalThis as any).NSFileManager = { defaultManager: () => unsupported ? { ...manager, moveItemAtPathToPath: undefined } : manager }
let cache: typeof import("../src/local-cache")
function reset(count: number) {
  dirs.clear(); dirs.add("/cache/CardLink"); dirs.add("/cache/CardLink/indexes"); files.clear(); for (let i = 0; i < count; i++) files.add(`/cache/CardLink/indexes/${i}.json`)
  reads = 0; preferredCalls = 0; legacyCalls = 0; failure = ""; unsupported = false
}
function finish() { let count = 0; while (callbacks.length) { assert.ok(++count < 2000); callbacks.shift()!() } }

test("6000文件任务先受理再分批遍历，进度可查询且有多次让出主线程", async () => {
  cache = await import("../src/local-cache")
  reset(6015)
  const initial = cache.startLocalCacheTask("scan")
  assert.equal(initial.status, "running")
  assert.equal(reads, 0)
  callbacks.shift()!()
  const partial = cache.localCacheTaskStatus(initial.taskId)
  assert.equal(partial.status, "running")
  assert.ok(partial.progress.visited > 0 && partial.progress.visited < 6015)
  assert.equal(initial.progress.visited, 0)
  assert.equal(cache.startLocalCacheTask("scan").taskId, initial.taskId)
  finish()
  const done = cache.localCacheTaskStatus(initial.taskId)
  assert.equal(done.status, "done")
  assert.equal(done.result!.groups.find(group => group.id === "indexes")!.files, 6015)
})

test("只移动到回收站不调用删除接口，保留分批处理进度直到结果核对完成", () => {
  reset(60)
  const task = cache.startLocalCacheTask("clear", ["indexes"], true)
  assert.equal(cache.isLocalCacheClearing(), true)
  assert.equal(preferredCalls, 0)
  while (cache.localCacheTaskStatus(task.taskId).progress.phase !== "clear") callbacks.shift()!()
  callbacks.shift()!()
  const partial = cache.localCacheTaskStatus(task.taskId)
  assert.equal(partial.status, "running")
  assert.ok(partial.progress.processed > 0 && partial.progress.processed < 60)
  finish()
  assert.equal(preferredCalls, 60)
  assert.equal(legacyCalls, 0)
  assert.equal(cache.localCacheTaskStatus(task.taskId).result!.removed, 60)
  assert.equal(cache.isLocalCacheClearing(), false)
})

test("失败原因回传，不把异常压成只有失败个数；接口缺失时停止而非逐文件失败", () => {
  reset(3); failure = "throw"
  const task = cache.startLocalCacheTask("clear", ["indexes"], true); finish()
  const result = cache.localCacheTaskStatus(task.taskId).result!
  assert.equal(result.failed, 3)
  assert.deepEqual(result.failures, [{ category: "indexes", reason: "permission denied", count: 3 }])
  assert.equal(files.size, 3)
  unsupported = true; reads = 0
  const missing = cache.startLocalCacheTask("clear", ["indexes"], true); finish()
  assert.equal(cache.localCacheTaskStatus(missing.taskId).status, "error")
  assert.match(cache.localCacheTaskStatus(missing.taskId).error!, /无法将文件移入回收站/)
  assert.equal(reads, 0)
})

test("原生静默未删除时明确回报文件仍存在", () => {
  reset(1); failure = "noop"
  const task = cache.startLocalCacheTask("clear", ["indexes"], true); finish()
  assert.match(cache.localCacheTaskStatus(task.taskId).result!.failures[0].reason, /未成功移入回收站/)
})
