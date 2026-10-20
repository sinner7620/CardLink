import { MN, NodeNote } from "marginnote"
import type { MbBookNote } from "marginnote"
import { MAIN_MINDMAP_SCOPE_ID, noteBelongsToMindMapScope } from "./mindmap-candidate"
export type { IndexScope as MindMapScope } from "./scope-key"
export { MAIN_MINDMAP_SCOPE_ID } from "./mindmap-candidate"

/** 具体脑图优先按根 ID 读取子树；分组别名或不可读层级交给原全量路径。 */
export function readMindMapBranch(notebookId: string, rootNodeId?: string): MbBookNote[] | undefined {
  if (!rootNodeId || rootNodeId === MAIN_MINDMAP_SCOPE_ID) return undefined
  try {
    const root = MN.db.getNoteById(rootNodeId)
    if (!root || (root.notebookId && root.notebookId !== notebookId)) return undefined
    const rootNode = new NodeNote(root, notebookId)
    if (nodeIdentifier(rootNode) !== rootNodeId || rootNode.note.childNotes == null) return undefined
    const notes: MbBookNote[] = []
    const visited = new Set<string>()
    const pending = [rootNode]
    while (pending.length) {
      const node = pending.pop()!
      const id = nodeIdentifier(node)
      if (!id) return undefined
      if (visited.has(id)) continue
      visited.add(id)
      if (visited.size > 50000) return undefined
      notes.push(node.note)
      // 不吞掉读取异常：部分子树不应成为“完整重建”的输入。
      const children = Array.from(node.childNodes ?? [])
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index])
    }
    return notes
  } catch {
    return undefined
  }
}

export function nodeIdentifier(node: NodeNote): string {
  return String(node.nodeId ?? node.note.noteId)
}

export function mindMapRoot(node: NodeNote): NodeNote {
  let current = node
  const visited = new Set<string>()
  while (current.parentNode) {
    const id = nodeIdentifier(current)
    if (visited.has(id)) break
    visited.add(id)
    current = current.parentNode
  }
  return current
}

export function isInMindMap(
  node: NodeNote,
  rootNodeId?: string,
  knownChildMapNoteIds: Iterable<string> | (() => Iterable<string>) = []
): boolean {
  if (!rootNodeId) return true
  if (noteBelongsToMindMapScope(node.note, rootNodeId, knownChildMapNoteIds)) return true
  if (rootNodeId === MAIN_MINDMAP_SCOPE_ID) return false
  if (nodeIdentifier(node) === rootNodeId) return true
  try {
    return node.ancestorNodes.some(ancestor => nodeIdentifier(ancestor) === rootNodeId)
  } catch {
    return false
  }
}
