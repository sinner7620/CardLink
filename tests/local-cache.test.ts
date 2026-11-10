import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

const files = new Set<string>()
const dirs = new Set<string>()
const sizes = new Map<string, number>()
let tempPathValue = "/tmp"
let failDelete = "", failRead = "", failSize = ""
mock.module("marginnote", { namedExports: { MN: { app: { cachePath: "/cache", get tempPath() { return tempPathValue }, documentPath: "/docs" } } } })
;(globalThis as any).NSFileManager = { defaultManager: () => ({
  fileExistsAtPath: (path: string) => files.has(path) || dirs.has(path),
  isDirectoryAtPath: (path: string) => dirs.has(path),
  contentsOfDirectoryAtPath: (path: string) => {
    if (path === failRead) return null
    return [...files, ...dirs].filter(item => item.startsWith(path + "/") && !item.slice(path.length + 1).includes("/"))
      .map(item => item.slice(path.length + 1))
  },
  attributesOfItemAtPath: (path: string) => { if (path === failSize) return {}; return { NSFileSize: sizes.get(path) ?? 1024 } },
  createDirectoryAtPathWithIntermediateDirectoriesAttributes(path: string) { while (path) { dirs.add(path); path = path.slice(0, path.lastIndexOf("/")) } },
  moveItemAtPathToPath(path: string, target: string) { if (path === failDelete) return false; files.add(target); files.delete(path); if (sizes.has(path)) { sizes.set(target, sizes.get(path)!); sizes.delete(path) }; return true }
}) }
let cache: typeof import("../src/local-cache")

test('通用清理即使确认删除保留文件也不删除活动 OCR 数据库及日志', async () => {
  const service = await import('../src/local-cache')
  reset()
  for (const name of ['cardlink-ocr.sqlite','cardlink-ocr.sqlite-journal']) files.add('/docs/CardLink/ocr-db/v1/'+name)
  dirs.add('/docs/CardLink/ocr-db'); dirs.add('/docs/CardLink/ocr-db/v1')
  const backup = '/docs/CardLink/ocr-db/v1/backups/CardLink-OCR-2026-11-09.json'
  addFile(backup, 20)
  const groups = service.scanLocalCache()
  assert.equal(groups.find(g => g.id === 'ocrDatabase')?.files, 2)
  assert.equal(groups.find(g => g.id === 'ocrBackups')?.bytes, 20)
  assert.throws(() => service.clearLocalCache(['ocrDatabase'],true))
  assert.throws(() => service.clearLocalCache(['ocrBackups']))
  service.clearLocalCache(['saved','other'],true)
  const before = service.scanLocalCache().find(g => g.id === 'recycle')?.bytes ?? 0
  assert.equal(service.clearLocalCache(['ocrBackups'],true).removed,1)
  assert.equal(files.has(backup),false)
  assert.equal(service.scanLocalCache().find(g => g.id === 'recycle')?.bytes,before + 20)
  assert.ok(files.has('/docs/CardLink/ocr-db/v1/cardlink-ocr.sqlite'))
  assert.ok(files.has('/docs/CardLink/ocr-db/v1/cardlink-ocr.sqlite-journal'))
})

function reset() {
  files.clear(); dirs.clear(); sizes.clear(); tempPathValue = "/tmp"; failRead = ""; failDelete = ""; failSize = ""
  for (const file of ["/cache/CardLink/indexes/a.json", "/tmp/CardLink/temp/pdf-cache/preview.pdf",
    "/tmp/CardLink/temp/templates/nested/a.zip", "/tmp/CardLink/temp/logs/log.json",
    "/docs/CardLink/plugin-ink/strokes.json", "/docs/CardLink/ai/ocr/a.json",
    "/docs/CardLink/backups/mistakes.json", "/cache/CardLink/updates/previous/main.js", "/tmp/other/file"]) {
    files.add(file)
    let path = file.slice(0, file.lastIndexOf("/"))
    while (path) { dirs.add(path); path = path.slice(0, path.lastIndexOf("/")) }
  }
}

test("扫描分类和嵌套临时文件，清理只删除指定类别且保留用户成果", async () => {
  cache = await import("../src/local-cache")
  const { scanLocalCache, clearLocalCache } = cache
  reset()
  assert.deepEqual(scanLocalCache().map(group => [group.id, group.files]), [["indexes", 1], ["pdf", 1], ["logs", 1], ["templates", 1], ["exports", 0], ["saved", 2], ["dataBackups", 1], ["ocrDatabase", 0], ["ocrBackups", 0], ["updates", 1], ["other", 0], ["recycle", 0]])
  assert.equal(scanLocalCache().reduce((sum, group) => sum + group.bytes!, 0), 8 * 1024)
  const result = clearLocalCache(["pdf", "templates"])
  assert.equal(result.removed, 2)
  assert.equal(result.failed, 0)
  assert.equal(files.has("/cache/CardLink/indexes/a.json"), true)
  assert.equal(files.has("/docs/CardLink/ai/ocr/a.json"), true)
  assert.equal(files.has("/docs/CardLink/backups/mistakes.json"), true)
  assert.equal(files.has("/docs/CardLink/plugin-ink/strokes.json"), true)
  assert.equal(files.has("/cache/CardLink/updates/previous/main.js"), true)
  assert.equal(files.has("/tmp/other/file"), true)
  assert.equal(result.groups.find(group => group.id === "pdf")?.files, 0)
})

test("不能传入路径或未知分类；删除失败和扫描失败不报告为成功", async () => {
  cache = await import("../src/local-cache")
  const { scanLocalCache, clearLocalCache } = cache
  reset()
  for (const ids of [null, [], ["../../docs"], ["indexes", "unknown"]]) assert.throws(() => clearLocalCache(ids))
  failDelete = "/tmp/CardLink/temp/pdf-cache/preview.pdf"
  assert.equal(clearLocalCache(["pdf"]).failed, 1)
  assert.equal(clearLocalCache(["pdf"]).removed, 0)
  failRead = "/cache/CardLink/indexes"
  assert.match(scanLocalCache()[0].error!, /无法读取/)
})

test("PDF 活动任务期间拒绝清理，完成后传递到缓存服务", () => {
  let called = 0
  const sandbox: any = { __MN_ANSWER_CORE_GLOBAL__: { bridge: () => { called++; return { removed: 1 } } } }
  runInNewContext(readFileSync("rails-native/WebBridgeCommands.js", "utf8"), sandbox)
  for (const status of ["preparing", "rendering", "saving"]) {
    assert.throws(() => sandbox.__MNAM_WEB_BRIDGE_GLOBAL__.dispatch({ controller: { exportPdfTask: { status } } }, "clearLocalCache", { ids: ["pdf"] }), /等待 PDF/)
  }
  assert.equal(called, 0)
  const result = sandbox.__MNAM_WEB_BRIDGE_GLOBAL__.dispatch({ controller: { exportPdfTask: { status: "done" } } }, "clearLocalCache", { ids: ["pdf"] })
  assert.equal(result.removed, 1)
  assert.equal(called, 1)
})


test("文件大小不可读时保留可清理文件数量，不伪报为零占用", async () => {
  const { scanLocalCache, clearLocalCache } = await import("../src/local-cache")
  reset()
  failSize = "/cache/CardLink/indexes/a.json"
  const group = scanLocalCache().find(item => item.id === "indexes")!
  assert.equal(group.files, 1)
  assert.equal(group.bytes, null)
  assert.match(group.sizeError!, /大小不可读/)
  assert.equal(clearLocalCache(["indexes"], true).removed, 1)
  assert.equal(scanLocalCache().find(item => item.id === "indexes")!.bytes, 0)
})


function addFile(path: string, bytes: number) {
  files.add(path); sizes.set(path, bytes)
  let parent = path.slice(0, path.lastIndexOf("/"))
  while (parent) { dirs.add(parent); parent = parent.slice(0, parent.lastIndexOf("/")) }
}

test("完整统计 210808185 字节文档目录，导出分类覆盖 exports 下的全部文件", async () => {
  const { scanLocalCache, clearLocalCache } = await import("../src/local-cache")
  reset()
  const image = "/docs/CardLink/exports/pdf-assets-20261107161500000/image.jpg"
  addFile(image, 210805113)
  let groups = scanLocalCache()
  assert.equal(groups.reduce((sum, group) => sum + group.documentBytes!, 0), 210808185)
  assert.equal(groups.find(group => group.id === "pdf")!.bytes, 1024)
  assert.equal(groups.find(group => group.id === "saved")!.clearable, false)
  assert.throws(() => clearLocalCache(["saved"]))
  assert.equal(groups.find(group => group.id === "updates")!.clearable, true)
  assert.throws(() => clearLocalCache(["indexes"]))
  addFile("/docs/CardLink/exports/my-export.zip", 30000)
  addFile("/docs/CardLink/unknown.bin", 10000)
  groups = scanLocalCache()
  assert.equal(groups.find(group => group.id === "exports")!.bytes, 210835113)
  assert.equal(groups.find(group => group.id === "other")!.bytes, 10000)
  clearLocalCache(["exports"])
  assert.equal(files.has(image), false)
  assert.equal(files.has("/docs/CardLink/exports/my-export.zip"), false)
  assert.equal(files.has("/docs/CardLink/unknown.bin"), true)
})

test("临时目录回退到文档目录时不重复统计；未读到的子目录明确标记统计不完整", async () => {
  const { scanLocalCache } = await import("../src/local-cache")
  reset(); tempPathValue = "/docs"
  addFile("/docs/CardLink/temp/pdf-cache/preview.pdf", 2048)
  const groups = scanLocalCache()
  assert.equal(groups.find(group => group.id === "pdf")!.bytes, 2048)
  assert.equal(groups.reduce((sum, group) => sum + group.documentBytes!, 0), 3 * 1024 + 2048)
  failRead = "/docs/CardLink/ai"
  const saved = scanLocalCache().find(group => group.id === "saved")!
  assert.equal(saved.bytes, null)
  assert.match(saved.error!, /无法读取目录/)
  assert.ok(saved.knownBytes > 0)
  const { clearLocalCache } = await import("../src/local-cache")
  assert.equal(clearLocalCache(["pdf"]).scanIncomplete, true)
})


test("PDF 任务渲染暂存计入可清理缓存", async () => {
  const { scanLocalCache, clearLocalCache } = await import("../src/local-cache")
  reset()
  const file = "/tmp/CardLink/temp/pdf-runtime/pdf-9/images.js"
  addFile(file, 2048)
  assert.equal(scanLocalCache().find(group => group.id === "pdf")!.bytes, 3072)
  assert.equal(clearLocalCache(["pdf"]).removed, 2)
  assert.equal(files.has(file), false)
})

test("保留文件仅在明确确认后按所选分类删除，其他类别和项目外文件不受影响", async () => {
  const { clearLocalCache } = await import("../src/local-cache")
  reset()
  assert.throws(() => clearLocalCache(["saved"]), /明确确认/)
  assert.equal(files.has("/docs/CardLink/plugin-ink/strokes.json"), true)
  const result = clearLocalCache(["saved"], true)
  assert.equal(result.removed, 2)
  assert.equal(files.has("/docs/CardLink/backups/mistakes.json"), true)
  assert.equal(files.has("/docs/CardLink/plugin-ink/strokes.json"), false)
  assert.equal(files.has("/cache/CardLink/updates/previous/main.js"), true)
  assert.equal(files.has("/cache/CardLink/indexes/a.json"), true)
  assert.equal(files.has("/tmp/other/file"), true)
  assert.throws(() => clearLocalCache(["../../docs"], true))
})
