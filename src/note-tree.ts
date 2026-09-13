import type { MbBookNote } from "marginnote"

/**
 * Notebook type constants per the official MbTopic reference: `type` is a
 * four-character constant converted to NSNumber ('NtMn' = MindMap). The npm
 * typings only declare the MN3-era `flags` (2 = MindMap), so both are honored.
 */
export const MN4_MINDMAP_NOTEBOOK_TYPE = 1316244846
const KNOWN_NOTEBOOK_TYPES = new Set([
  1316242276, // 'NtCd' CardDeck
  1316242542, // 'NtDn' DocumentNotebook
  MN4_MINDMAP_NOTEBOOK_TYPE,
  1316245102 // 'NtNn' Null
])

export function isMindMapNotebook(notebook: unknown): boolean {
  const topic = notebook as { type?: unknown; flags?: unknown } | null | undefined
  const type = Number(topic?.type)
  if (Number.isFinite(type) && KNOWN_NOTEBOOK_TYPES.has(type)) {
    return type === MN4_MINDMAP_NOTEBOOK_TYPE
  }
  return Number(topic?.flags) === 2
}

function cleanNoteId(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function noteKey(note: unknown): string {
  return cleanNoteId((note as { noteId?: unknown } | null | undefined)?.noteId)
}

function childNotesOf(note: unknown): unknown[] {
  try {
    const children = (note as { childNotes?: unknown } | null | undefined)?.childNotes
    return children ? Array.from(children as ArrayLike<unknown>) : []
  } catch {
    return []
  }
}

type NotesShape = "flat" | "root-only"
const notebookShapeCache = new Map<string, NotesShape>()
const NOTE_SHAPE_CACHE_LIMIT = 200
const SHAPE_PROBE_LIMIT = 240
const SHAPE_ROOT_PROBES = 40
const SHAPE_DEPTH_LIMIT = 24
const NOTE_TREE_MAX_NODES = 50000

/**
 * The official MbTopic reference states `notes` contains only root notes,
 * while the MN3-era typings describe it as "notes in the notebook". Both
 * behaviors have been observed across MarginNote versions, so the actual shape
 * is probed once per notebook and normalized to a flat list either way —
 * indexing, ordered pairing and child mind-map discovery then see the same
 * tree regardless of which semantics the running build implements.
 */
export function notebookNotes(notebook: unknown): MbBookNote[] {
  const notes = Array.from(
    ((notebook as { notes?: unknown } | null | undefined)?.notes as ArrayLike<unknown> | undefined) ?? []
  )
  if (!notes.length) return []
  const notebookId = cleanNoteId((notebook as { topicId?: unknown } | null | undefined)?.topicId)
  if (notebookId) {
    const cached = notebookShapeCache.get(notebookId)
    if (cached) return cached === "flat" ? (notes as MbBookNote[]) : flattenFromRoots(notes)
    if (notebookShapeCache.size >= NOTE_SHAPE_CACHE_LIMIT) notebookShapeCache.clear()
  }
  const shape = detectNotesShape(notes)
  if (notebookId) notebookShapeCache.set(notebookId, shape)
  return shape === "flat" ? (notes as MbBookNote[]) : flattenFromRoots(notes)
}

/**
 * 形态探测结果只在首次碰到该学习集时得出：若探测发生在学习集尚未同步完整的
 * 瞬间，错误的 flat/root-only 归一会被长期缓存。索引重建是唯一能整体纠正的
 * 时机，重建入口必须先清空该缓存再重新探测。
 */
export function clearNotebookShapeCache(): void {
  notebookShapeCache.clear()
}

function detectNotesShape(notes: unknown[]): NotesShape {
  const idSet = new Set<string>()
  for (const note of notes) {
    const key = noteKey(note)
    if (key) idSet.add(key)
  }
  for (let index = 0; index < Math.min(notes.length, SHAPE_PROBE_LIMIT); index++) {
    const parent = (notes[index] as { parentNote?: unknown } | null | undefined)?.parentNote
    if (parent && typeof parent === "object" && idSet.has(noteKey(parent))) {
      // The list itself contains non-root notes: flat full-list semantics.
      return "flat"
    }
  }
  // No listed note has a listed parent. If any descendant chain reaches a note
  // that is not listed, the official root-only semantics apply.
  for (let index = 0; index < Math.min(notes.length, SHAPE_ROOT_PROBES); index++) {
    if (containsUnlistedDescendant(notes[index], idSet, 0)) return "root-only"
  }
  return "flat"
}

function containsUnlistedDescendant(note: unknown, idSet: Set<string>, depth: number): boolean {
  if (depth >= SHAPE_DEPTH_LIMIT) return false
  for (const child of childNotesOf(note)) {
    if (!child || typeof child !== "object") continue
    const key = noteKey(child)
    if (!key || !idSet.has(key)) return true
    if (containsUnlistedDescendant(child, idSet, depth + 1)) return true
  }
  return false
}

function flattenFromRoots(roots: unknown[]): MbBookNote[] {
  const flat: unknown[] = []
  const seen = new Set<string>()
  const stack = [...roots]
  while (stack.length && flat.length < NOTE_TREE_MAX_NODES) {
    const note = stack.pop()
    if (!note || typeof note !== "object") continue
    const key = noteKey(note)
    if (key && seen.has(key)) continue
    flat.push(note)
    if (key) seen.add(key)
    const children = childNotesOf(note)
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index])
  }
  return flat as MbBookNote[]
}
