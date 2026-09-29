import { getLocalDataByKey, isfileExists, MN, readJSON, setLocalDataByKey, writeTextFile } from "marginnote"
import { cardLinkCachePath, ensureStorageDirectory, migrateLegacyFile } from "./storage-paths"

const INDEX_KEY_PREFIX = "mn4-answer-matcher.index.v1."
const INDEX_FILE_PREFIX = "mn4-answer-matcher.index.v1."
const INDEX_FILE_SUFFIX = ".json"
const INDEX_UPDATED_AT_PREFIX = "mn4-answer-matcher.index-updated-at.v1."

export interface StoredAnswerIndexItem {
  id: string
  noteId: string
  notebookId: string
  pathTitles: string[]
  titles: string[]
  tags: string[]
  comments: string[]
  excerpts: string[]
  children: Array<{ title: string; text: string }>
}

/**
 * 索引快照是缓存（丢失可重建），按官方语义存 Application.cachePath 文件而非
 * NSUserDefaults：数 MB 的 plist 序列化不再发生在配置存储里，系统也可按缓存
 * 策略回收。每个学习集一个文件，刷新时只重写自己的那份。
 */
function indexFilePath(notebookId: string): string | undefined {
  try {
    const root = MN.app.cachePath
    if (!root) return undefined
    const safe = String(notebookId || "").replace(/[^\w-]/g, "_")
    if (!safe) return undefined
    const directory = cardLinkCachePath("indexes")
    if (!directory) return undefined
    ensureStorageDirectory(directory)
    const path = `${directory}/${INDEX_FILE_PREFIX}${safe}${INDEX_FILE_SUFFIX}`
    migrateLegacyFile(`${String(root).replace(/\/$/, "")}/${INDEX_FILE_PREFIX}${safe}${INDEX_FILE_SUFFIX}`, path)
    return path
  } catch {
    return undefined
  }
}

export function loadStoredIndex(notebookId: string): StoredAnswerIndexItem[] | undefined {
  const path = indexFilePath(notebookId)
  if (path) {
    try {
      if (isfileExists(path)) {
        const parsed = readJSON(path)
        // 空数组也是有效快照：表示“已建立但该范围 0 张卡”，
        // 拒绝它会让空答案范围的每次查找都误报“索引尚未建立”。
        if (Array.isArray(parsed)) return parsed as StoredAnswerIndexItem[]
      }
    } catch {
      // 文件不可读则回退旧存储
    }
  }
  // 旧版快照存 NSUserDefaults：读到即迁移到文件，迁移成功后清空旧键瘦身配置存储
  try {
    const legacy = getLocalDataByKey(`${INDEX_KEY_PREFIX}${notebookId}`)
    if (legacy && typeof legacy === "object") {
      const items = Array.from(legacy as ArrayLike<StoredAnswerIndexItem>)
      if (items.length) {
        saveStoredIndex(notebookId, items)
        return items
      }
    }
  } catch {
    // 旧存储不可读则视为无快照
  }
  return undefined
}

export function saveStoredIndex(
  notebookId: string,
  answers: StoredAnswerIndexItem[]
): void {
  const updatedAt = new Date().toISOString()
  const payload = JSON.stringify(answers)
  const path = indexFilePath(notebookId)
  if (path) {
    try {
      writeTextFile(path, payload)
      // writeTextFile 无返回值：回读校验成功才算落盘，并清空旧 NSUserDefaults 键
      if (isfileExists(path)) {
        const parsed = readJSON(path)
        if (Array.isArray(parsed) && parsed.length === answers.length) {
          try { setLocalDataByKey("", `${INDEX_KEY_PREFIX}${notebookId}`) } catch {
            // 旧键清不掉不影响正确性
          }
          try { setLocalDataByKey(updatedAt, `${INDEX_UPDATED_AT_PREFIX}${notebookId}`) } catch {}
          return
        }
      }
    } catch {
      // 落盘失败则回退旧存储
    }
  }
  try {
    setLocalDataByKey(answers, `${INDEX_KEY_PREFIX}${notebookId}`)
    setLocalDataByKey(updatedAt, `${INDEX_UPDATED_AT_PREFIX}${notebookId}`)
  } catch {
    // 两路都失败则放弃快照，下次刷新重建即可
  }
}

export function storedIndexUpdatedAt(notebookId: string): string | undefined {
  try {
    const value = getLocalDataByKey(`${INDEX_UPDATED_AT_PREFIX}${notebookId}`)
    return typeof value === "string" && value ? value : undefined
  } catch {
    return undefined
  }
}
