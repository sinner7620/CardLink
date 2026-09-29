export interface QuestionTreeNode {
  id: string
  title: string
  question: boolean
  children: QuestionTreeNode[]
  questionIds: string[]
}

interface NoteLike {
  noteId?: unknown
  noteTitle?: unknown
  parentNote?: NoteLike | null
  colorIndex?: unknown
}

/** Only nodes owned by the active mind-map view can be offered as questions. */
export function renderedMindMapNoteIds(map: { mindmapNodes?: ArrayLike<{ note?: NoteLike }> } | null | undefined): Set<string> {
  const ids = new Set<string>()
  for (const node of Array.from(map?.mindmapNodes ?? [])) {
    const id = String(node?.note?.noteId ?? "").trim()
    if (id) ids.add(id)
  }
  return ids
}

export function mindMapScopeOf(note: NoteLike | null | undefined, childMapNoteIds: ReadonlySet<string>): string {
  const seen = new Set<string>()
  let current = note
  while (current) {
    const id = String(current.noteId ?? "").trim()
    if (!id || seen.has(id)) break
    if (childMapNoteIds.has(id)) return id
    seen.add(id)
    current = current.parentNote
  }
  return "__mn4_main_mindmap__"
}

function titleOf(note: NoteLike): string {
  const text = String(note.noteTitle ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  return text.slice(0, 120) || "未命名卡片"
}

/** Keep real question nodes and their parent chain in notebook order. */
export function collectQuestionTree(
  notes: Iterable<NoteLike>,
  questionColorIndex: number | readonly number[] | undefined,
  belongsToCurrentMindMap: (note: NoteLike) => boolean
): QuestionTreeNode[] {
  const colors = Array.isArray(questionColorIndex) ? new Set(questionColorIndex) :
    questionColorIndex === undefined ? undefined : new Set([questionColorIndex])
  if (colors && [...colors].some(color => !Number.isInteger(color))) return []
  const all = Array.from(notes)
  const byId = new Map<string, NoteLike>()
  for (const note of all) {
    const id = String(note.noteId ?? "").trim()
    if (id) byId.set(id, note)
  }
  const roots: QuestionTreeNode[] = []
  const visible = new Map<string, QuestionTreeNode>()
  for (const question of all) {
    if (typeof question.colorIndex !== "number" || !Number.isInteger(question.colorIndex) ||
      (colors && !colors.has(question.colorIndex as number)) ||
      !belongsToCurrentMindMap(question)) continue
    const questionId = String(question.noteId ?? "").trim()
    if (!questionId) continue
    // A question's descendants are its content/answers, never extra questions.
    const ancestors = new Set<string>([questionId])
    let parent = question.parentNote
    let insideQuestion = false
    while (parent) {
      const id = String(parent.noteId ?? "").trim()
      if (!id || ancestors.has(id)) break
      ancestors.add(id)
      if (colors && belongsToCurrentMindMap(parent) && typeof parent.colorIndex === "number" &&
        Number.isInteger(parent.colorIndex) && colors.has(parent.colorIndex)) {
        insideQuestion = true
        break
      }
      parent = byId.get(String(parent.parentNote?.noteId ?? "").trim())
    }
    if (insideQuestion) continue
    const chain: NoteLike[] = []
    const seen = new Set<string>()
    let current: NoteLike | undefined = question
    while (current) {
      const id = String(current.noteId ?? "").trim()
      if (!id || seen.has(id) || !belongsToCurrentMindMap(current)) break
      seen.add(id)
      chain.unshift(current)
      const parentId = String(current.parentNote?.noteId ?? "").trim()
      current = parentId ? byId.get(parentId) : undefined
    }
    let siblings = roots
    for (const note of chain) {
      const id = String(note.noteId).trim()
      let node = visible.get(id)
      if (!node) {
        node = { id, title: titleOf(note), question: false, children: [], questionIds: [] }
        visible.set(id, node)
        siblings.push(node)
      }
      if (!node.questionIds.includes(questionId)) node.questionIds.push(questionId)
      if (id === questionId) node.question = true
      siblings = node.children
    }
  }
  return roots
}

export function questionIdsInTree(nodes: QuestionTreeNode[]): string[] {
  return Array.from(new Set(nodes.flatMap(node => node.questionIds)))
}
