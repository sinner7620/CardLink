import test, { mock } from "node:test"
import assert from "node:assert/strict"

mock.module("marginnote", { namedExports: { MN: { app: { documentPath: "/docs", cachePath: "/cache", tempPath: "/tmp" } } } })
const original = "/cache/CardLink/indexes/answer.json"
let files = new Map<string, number>(), directories = new Set<string>(), failure = "", closed = 0, opened = 0
const manager = {
  // Match classic JSB: neither removeItemAtPath nor removeItemAtPathError exists.
  fileExistsAtPath: (path: string) => files.has(path) || directories.has(path),
  isDirectoryAtPath: (path: string) => directories.has(path),
  contentsOfDirectoryAtPath: (path: string) => [...directories, ...files.keys()].filter(p => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/")).map(p => p.slice(path.length + 1)),
  attributesOfItemAtPath: (path: string) => ({ NSFileSize: files.get(path) }),
  createDirectoryAtPathWithIntermediateDirectoriesAttributes(path: string) { if (failure !== "directory") while (path) { directories.add(path); path = path.slice(0, path.lastIndexOf("/")) } },
  moveItemAtPathToPath(source: string, target: string) {
    if (failure === "move") return false
    if (failure === "throw") throw Error("move denied")
    if (!files.has(source) || files.has(target)) return false
    files.set(target, files.get(source)!); files.delete(source); return true
  }
}
;(globalThis as any).NSFileManager = { defaultManager: () => manager }
;(globalThis as any).NSFileHandle = { fileHandleForWritingAtPath() { throw Error("must not truncate file content") } }
let cache: typeof import("../src/local-cache")
function reset(mode = "") {
  files = new Map([[original, 2100000000]])
  directories = new Set(["/cache/CardLink", "/cache/CardLink/indexes"])
  failure = mode; closed = 0; opened = 0
}

test("classic JSB无删除接口仍可完整移入回收站，占用保留且原文件名不变", async () => {
  cache = await import("../src/local-cache")
  reset()
  const result = cache.clearLocalCache(["indexes"], true)
  assert.equal(result.removed, 1)
  assert.equal(result.failed, 0)
  assert.equal(files.has(original), false)
  assert.equal([...files.values()].reduce((sum, bytes) => sum + bytes, 0), 2100000000)
  assert.ok([...files.keys()].every(path => path.startsWith("/docs/CardLink/回收站/") && path.endsWith("/缓存/indexes/answer.json")))
  const recycle = result.groups.find(group => group.id === "recycle")!
  assert.equal(recycle.files, 1)
  assert.equal(recycle.bytes, 2100000000)
  assert.equal(recycle.recyclePath, "/docs/CardLink/回收站")
  assert.equal(result.groups.reduce((sum, group) => sum + group.bytes!, 0), 2100000000)
  assert.throws(() => cache.clearLocalCache(["recycle"], true))
  assert.equal(cache.clearLocalCache(["other"], true).removed, 0)
  assert.equal(files.size, 1)
  files.clear() // User removes the recycle folder in Files; next manual scan reflects it.
  assert.equal(cache.scanLocalCache().find(group => group.id === "recycle")!.files, 0)
})

for (const mode of ["directory", "move", "throw"]) test(`回收站${mode}失败不报成功，原文件内容保留`, () => {
  reset(mode)
  const result = cache.clearLocalCache(["indexes"], true)
  assert.equal(result.removed, 0)
  assert.equal(result.failed, 1)
  assert.equal(files.get(original), 2100000000)
  assert.equal(files.size, 1)
  assert.ok(result.failures[0].reason)
})

test("不同来源同名文件及重复批次不覆盖回收站已有文件", () => {
  reset()
  files.set("/docs/CardLink/indexes/answer.json", 5)
  directories.add("/docs/CardLink"); directories.add("/docs/CardLink/indexes")
  const result = cache.clearLocalCache(["indexes", "other"], true)
  assert.equal(result.removed, 2)
  files.set(original, 7)
  assert.equal(cache.clearLocalCache(["indexes"], true).removed, 1)
  assert.equal(files.size, 3)
  assert.deepEqual([...files.values()].sort((a,b)=>a-b), [5, 7, 2100000000])
  assert.equal(cache.scanLocalCache().find(group => group.id === "recycle")!.files, 3)
})
