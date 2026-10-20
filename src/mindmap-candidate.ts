export const MAIN_MINDMAP_SCOPE_ID = "__mn4_main_mindmap__"

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function childMindMapNoteId(note: unknown): string {
  if (!note || typeof note !== "object") return ""
  const childMindMap = (note as { childMindMap?: unknown }).childMindMap
  if (!childMindMap || typeof childMindMap !== "object") return ""
  return cleanId((childMindMap as { noteId?: unknown }).noteId)
}

export function collectChildMindMapNoteIds(notes: Iterable<unknown>): string[] {
  const ids = new Set<string>()
  for (const note of notes) {
    const id = childMindMapNoteId(note)
    if (id) ids.add(id)
  }
  return [...ids]
}

export function mindMapScopeIdForNote(
  note: unknown,
  knownChildMapNoteIds: Iterable<string> | (() => Iterable<string>) = []
): string {
  const childId = childMindMapNoteId(note)
  if (childId) return childId
  if (note && typeof note === "object") {
    const noteId = cleanId((note as { noteId?: unknown }).noteId)
    if (noteId) {
      // 普通子脑图卡片已由 childMindMap 确认；只有根卡片等无直接归属的
      // 情况才读取候选，避免调用方提前扫描整个学习集。
      const knownIds = typeof knownChildMapNoteIds === "function" ? knownChildMapNoteIds() : knownChildMapNoteIds
      for (const childMapId of knownIds) {
        if (noteId === childMapId) return childMapId
      }
    }
  }
  return MAIN_MINDMAP_SCOPE_ID
}

export function noteBelongsToMindMapScope(
  note: unknown,
  scopeId: string,
  knownChildMapNoteIds: Iterable<string> | (() => Iterable<string>) = []
): boolean {
  if (!note || typeof note !== "object") return false
  const noteId = cleanId((note as { noteId?: unknown }).noteId)
  const childId = childMindMapNoteId(note)
  if (scopeId === MAIN_MINDMAP_SCOPE_ID) {
    if (childId) return false
    const knownIds = typeof knownChildMapNoteIds === "function" ? knownChildMapNoteIds() : knownChildMapNoteIds
    for (const childMapId of knownIds) {
      if (noteId === childMapId) return false
    }
    return true
  }
  return childId === scopeId || noteId === scopeId
}
