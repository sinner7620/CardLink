import { MN } from "marginnote"

export interface LocalCacheGroup {
  id: string; title: string; clearable: boolean; files: number; bytes: number | null; knownBytes: number
  documentFiles: number; documentBytes: number | null; documentKnownBytes: number; paths: string[]; scanRoots: string[]
  error?: string; sizeError?: string; recyclePath?: string
}
const categories = [
  { id: "indexes", title: "答案索引", clearable: false },
  { id: "pdf", title: "PDF 预览与导出图片暂存", clearable: true },
  { id: "logs", title: "诊断日志", clearable: true },
  { id: "templates", title: "模板临时文件", clearable: true },
  { id: "exports", title: "导出文件", clearable: true },
  { id: "saved", title: "手写与 AI", clearable: false },
  { id: "dataBackups", title: "插件数据备份", clearable: false },
  { id: "ocrDatabase", title: "OCR 数据库", clearable: false },
  { id: "ocrBackups", title: "OCR 数据库备份", clearable: false },
  { id: "updates", title: "更新包与恢复备份", clearable: true },
  { id: "other", title: "其他本地文件", clearable: false },
  { id: "recycle", title: "回收站（待手动删除）", clearable: false }
]
const clean = (value: unknown) => String(value || "").replace(/\/+$/, "")
function roots() {
  const documentBase = clean(MN.app.documentPath), cacheBase = clean(MN.app.cachePath)
  const tempBase = clean(MN.app.tempPath || MN.app.documentPath)
  const document = documentBase ? `${documentBase}/CardLink` : ""
  const cache = cacheBase ? `${cacheBase}/CardLink` : ""
  const temp = tempBase ? `${tempBase}/CardLink` : ""
  // tempPath can equal documentPath. Walk each physical subtree once.
  const scan = [...new Set([document, cache, temp].filter(Boolean))].sort((a, b) => a.length - b.length)
    .filter((path, index, all) => !all.slice(0, index).some(parent => path.startsWith(parent + "/")))
  return { document, cache, recycle: document ? `${document}/回收站` : "", temp: temp ? `${temp}/temp` : "", scan }
}
function categoryOf(path: string, storage: ReturnType<typeof roots>): string {
  const under = (root: string, suffix: string) => !!root && path.startsWith(`${root}/${suffix}/`)
  if (storage.recycle && path.startsWith(storage.recycle + "/")) return "recycle"
  if (under(storage.cache, "indexes")) return "indexes"
  if (under(storage.temp, "pdf-cache") || under(storage.temp, "pdf-runtime")) return "pdf"
  if (under(storage.temp, "logs")) return "logs"
  if (under(storage.temp, "templates")) return "templates"
  if (under(storage.document, "exports")) return "exports"
  if (under(storage.document, "ocr-db/v1/backups")) return "ocrBackups"
  if (under(storage.document, "ocr-db")) return "ocrDatabase"
  if (under(storage.document, "backups")) return "dataBackups"
  if (["plugin-ink", "ai"].some(folder => under(storage.document, folder))) return "saved"
  if ([storage.document, storage.cache, storage.temp].some(root => under(root, "updates"))) return "updates"
  return "other"
}
interface Inventory { files: string[]; errors: Array<{ path: string; message: string }> }
function* inventory(manager: any, storage: ReturnType<typeof roots>, progress?: LocalCacheProgress): Generator<void, Inventory> {
  const files: string[] = [], errors: Inventory["errors"] = []
  const pending = [...storage.scan], seen = new Set<string>()
  while (pending.length) {
    const directory = pending.pop()!
    if (seen.has(directory)) continue
    seen.add(directory)
    if (progress) progress.directories++
    yield
    try {
      if (!manager.fileExistsAtPath(directory)) continue
      const entries = manager.contentsOfDirectoryAtPath(directory)
      if (!entries) throw new Error("无法读取目录")
      for (const name of Array.from(entries) as string[]) {
        if (!name || name === "." || name === ".." || /[/\\]/.test(name)) throw new Error("文件名无效")
        const child = `${directory}/${name}`
        let type: unknown
        try {
          const attributes = manager.attributesOfItemAtPath(child)
          type = attributes?.NSFileType ?? attributes?.objectForKey?.("NSFileType")
        } catch { /* A size failure must not stop enumeration of siblings. */ }
        if (String(type) === "NSFileTypeDirectory" || (type == null && manager.isDirectoryAtPath(child))) pending.push(child)
        else { files.push(child); if (progress) progress.visited++ }
        yield
      }
    } catch (error) { errors.push({ path: directory, message: String((error as Error).message || error) }) }
  }
  return { files, errors }
}
function* scan(progress?: LocalCacheProgress): Generator<void, LocalCacheGroup[]> {
  const manager: any = NSFileManager.defaultManager(), storage = roots(), items = yield* inventory(manager, storage, progress)
  const groups: LocalCacheGroup[] = categories.map(category => ({ ...category, ...(category.id === "recycle" ? { recyclePath: storage.recycle } : {}), files: 0, bytes: 0, knownBytes: 0, documentFiles: 0, documentBytes: 0, documentKnownBytes: 0, paths: [], scanRoots: storage.scan }))
  const byId = new Map(groups.map(group => [group.id, group]))
  for (const file of items.files) {
    const group = byId.get(categoryOf(file, storage))!
    const inDocument = !!storage.document && file.startsWith(storage.document + "/")
    group.files++
    if (inDocument) group.documentFiles++
    const parent = file.slice(0, file.lastIndexOf("/"))
    if (!group.paths.includes(parent)) group.paths.push(parent)
    try {
      const attributes = manager.attributesOfItemAtPath(file)
      const value = attributes?.NSFileSize ?? attributes?.objectForKey?.("NSFileSize")
      const size = value === undefined || value === null ? NaN : Number(value)
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("文件大小不可读")
      group.knownBytes += size
      if (inDocument) group.documentKnownBytes += size
      if (group.bytes !== null) group.bytes += size
      if (inDocument && group.documentBytes !== null) group.documentBytes += size
    } catch {
      group.bytes = null
      if (inDocument) group.documentBytes = null
      group.sizeError = "部分文件大小不可读"
    }
    if (progress) progress.processed++
    yield
  }
  for (const issue of items.errors) {
    const group = byId.get(categoryOf(issue.path + "/", storage))!
    group.bytes = null
    if (storage.document && (issue.path === storage.document || issue.path.startsWith(storage.document + "/"))) group.documentBytes = null
    group.error = `${issue.message}：${issue.path}`
    if (!group.paths.includes(issue.path)) group.paths.push(issue.path)
  }
  return groups
}

export interface LocalCacheProgress {
  phase: "scan" | "clear" | "verify"
  directories: number; visited: number; processed: number; total: number
  removed: number; failed: number; skipped: number
}
export interface LocalCacheResult {
  groups: LocalCacheGroup[]; removed: number; failed: number; skipped: number; scanIncomplete: boolean
  failures: Array<{ category: string; reason: string; count: number }>
}
function validateSelection(ids: unknown, allowRetained: boolean): asserts ids is string[] {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !categories.some(category => category.id === id && category.id !== "recycle" && category.id !== "ocrDatabase" && (category.clearable || allowRetained === true)))) {
    throw new Error("请选择有效文件分类；删除保留文件需要明确确认")
  }
}
let recycleSequence = 0
function recycleMover(manager: any, storage: ReturnType<typeof roots>): (path: string) => void {
  if (!storage.recycle || typeof manager.moveItemAtPathToPath !== "function") throw new Error("当前宿主无法将文件移入回收站，未更改文件")
  let batch: string
  do { batch = `${storage.recycle}/${Date.now()}-${++recycleSequence}` } while (manager.fileExistsAtPath(batch))
  return path => {
    const source = [
      { root: storage.document, name: "文稿" },
      { root: storage.cache, name: "缓存" },
      { root: storage.temp, name: "临时文件" }
    ].filter(item => item.root && path.startsWith(item.root + "/")).sort((a, b) => b.root.length - a.root.length)[0]
    if (!source || path.startsWith(storage.recycle + "/")) throw new Error("文件不在可移入回收站的范围内")
    const target = `${batch}/${source.name}/${path.slice(source.root.length + 1)}`
    const parent = target.slice(0, target.lastIndexOf("/"))
    if (!manager.fileExistsAtPath(parent)) manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes(parent, true, null)
    if (!manager.fileExistsAtPath(parent)) throw new Error("无法创建回收站目录，未移动文件")
    if (manager.fileExistsAtPath(target)) throw new Error("回收站存在同名文件，未覆盖")
    const moved = manager.moveItemAtPathToPath(path, target)
    if (moved === false || manager.fileExistsAtPath(path) || !manager.fileExistsAtPath(target)) throw new Error("文件未成功移入回收站")
  }
}
function* clear(ids: string[], allowRetained: boolean, progress?: LocalCacheProgress): Generator<void, LocalCacheResult> {
  validateSelection(ids, allowRetained)
  const manager: any = NSFileManager.defaultManager(), storage = roots(), move = recycleMover(manager, storage)
  const items = yield* inventory(manager, storage, progress)
  const targets = items.files.filter(file => ids.includes(categoryOf(file, storage)))
  if (progress) { progress.phase = "clear"; progress.processed = 0; progress.total = targets.length }
  yield
  let removed = 0, failed = 0, skipped = 0
  const failures: LocalCacheResult["failures"] = []
  for (const file of targets) {
    if (file.startsWith(`${storage.document}/ocr-db/`) && !(categoryOf(file, storage) === "ocrBackups" && /^CardLink-OCR-[^/]+\.json$/.test(file.slice(`${storage.document}/ocr-db/v1/backups/`.length)))) skipped++
    else try {
      if (manager.fileExistsAtPath(file)) move(file)
      if (manager.fileExistsAtPath(file)) throw new Error("移动后原文件仍存在，宿主未完成移动")
      removed++
    } catch (error) {
      failed++
      let reason = String((error as Error)?.message || error)
      for (const root of storage.scan) reason = reason.split(root).join("<CardLink>")
      reason = reason.slice(0, 200)
      const category = categoryOf(file, storage), existing = failures.find(item => item.category === category && item.reason === reason)
      if (existing) existing.count++
      else if (failures.length < 8) failures.push({ category, reason, count: 1 })
    }
    if (progress) { progress.processed++; progress.removed = removed; progress.failed = failed; progress.skipped = skipped }
    yield
  }
  if (progress) { progress.phase = "verify"; progress.processed = 0; progress.directories = 0; progress.visited = 0; progress.total = 0 }
  const groups = yield* scan(progress)
  return { removed, failed, skipped, failures, scanIncomplete: items.errors.length > 0 || groups.some(group => !!group.error), groups }
}
function drain<T>(work: Generator<void, T>): T {
  let next = work.next()
  while (!next.done) next = work.next()
  return next.value
}
// Synchronous helpers retained for existing non-UI callers and behavior tests.
export function scanLocalCache(): LocalCacheGroup[] { return drain(scan()) }
export function clearLocalCache(ids: unknown, allowRetained = false): LocalCacheResult {
  validateSelection(ids, allowRetained)
  return drain(clear(ids, allowRetained))
}

export interface LocalCacheTask {
  taskId: string; operation: "scan" | "clear"; status: "running" | "done" | "error"
  progress: LocalCacheProgress; result?: LocalCacheResult; error?: string
}
let activeTask: LocalCacheTask | undefined
let sequence = 0
const tasks = new Map<string, LocalCacheTask>()
const snapshot = (task: LocalCacheTask): LocalCacheTask => ({ ...task, progress: { ...task.progress } })
export function isLocalCacheClearing(): boolean { return activeTask?.status === "running" && activeTask.operation === "clear" }
export function localCacheTaskStatus(taskId: string): LocalCacheTask {
  const task = tasks.get(taskId)
  if (!task) throw new Error("缓存任务已失效，请重新扫描")
  return snapshot(task)
}
export function startLocalCacheTask(operation: "scan" | "clear", ids?: unknown, allowRetained = false): LocalCacheTask {
  if (operation !== "scan" && operation !== "clear") throw new Error("无效的缓存任务")
  if (operation === "clear") validateSelection(ids, allowRetained)
  // Reopening the panel attaches to the running operation instead of starting another traversal.
  if (activeTask?.status === "running") return snapshot(activeTask)
  for (const [key, task] of tasks) if (task.status !== "running") tasks.delete(key)
  const task: LocalCacheTask = {
    taskId: `cache-${Date.now()}-${++sequence}`, operation, status: "running",
    progress: { phase: "scan", directories: 0, visited: 0, processed: 0, total: 0, removed: 0, failed: 0, skipped: 0 }
  }
  activeTask = task; tasks.set(task.taskId, task)
  const work = operation === "scan" ? (function* (): Generator<void, LocalCacheResult> {
    const groups = yield* scan(task.progress)
    return { groups, removed: 0, failed: 0, skipped: 0, failures: [], scanIncomplete: groups.some(group => !!group.error) }
  })() : clear(ids as string[], allowRetained, task.progress)
  function step() {
    try {
      const started = Date.now()
      for (let count = 0; count < 24 && Date.now() - started < 8; count++) {
        const next = work.next()
        if (next.done) { task.result = next.value; task.status = "done"; return }
      }
      NSTimer.scheduledTimerWithTimeInterval(.016, false, step)
    } catch (error) { task.status = "error"; task.error = String((error as Error)?.message || error) }
  }
  // Return the acceptance reply before the first filesystem call.
  NSTimer.scheduledTimerWithTimeInterval(.05, false, step)
  return snapshot(task)
}
