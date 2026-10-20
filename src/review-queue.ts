export interface ReviewSource {
  sourceNotebookId: string
  sourceNotebookTitle: string
  sourceRootNodeId?: string
  sourceRootTitle?: string
  sourceAncestors?: Array<{ id: string; title: string }>
}

export function reviewedToday(lastReviewedAt?: string, now = new Date()): boolean {
  if (!lastReviewedAt) return false
  const date = new Date(lastReviewedAt)
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

export function reviewBreadcrumbs(item: ReviewSource): Array<{ kind: string; id: string; title: string }> {
  return [
    { kind: 'study', id: item.sourceNotebookId, title: item.sourceNotebookTitle || '学习集' },
    { kind: 'map', id: item.sourceRootNodeId || 'main', title: item.sourceRootTitle || '主脑图' },
    ...(item.sourceAncestors || []).filter(node => node.id !== item.sourceRootNodeId)
      .map(node => ({ ...node, kind: 'parent' }))
  ]
}

export function inReviewBranch(candidate: ReviewSource, current: ReviewSource, crumb: { kind: string; id: string }): boolean {
  if (candidate.sourceNotebookId !== current.sourceNotebookId) return false
  if (crumb.kind === 'study') return true
  if ((candidate.sourceRootNodeId || 'main') !== (current.sourceRootNodeId || 'main')) return false
  return crumb.kind === 'map' || !!candidate.sourceAncestors?.some(node => node.id === crumb.id)
}


export interface ReviewQueueRow {
  kind: 'heading' | 'question'
  title: string
  index: number
  depth: number
}

/** Group only the selected subtree; retain original queue indexes for navigation. */
export function groupedReviewRows(items: Array<ReviewSource & { sourceTitle?: string }>, current: ReviewSource, crumb: { kind: string; id: string }): ReviewQueueRow[] {
  interface Group { title: string; children: Map<string, Group>; questions: ReviewQueueRow[] }
  const root: Group = { title: '', children: new Map(), questions: [] }
  items.forEach((item, index) => {
    if (!inReviewBranch(item, current, crumb)) return
    const path = reviewBreadcrumbs(item)
    const start = path.findIndex(node => node.kind === crumb.kind && node.id === crumb.id)
    let group = root
    const tail = path.slice(start + 1)
    tail.forEach(node => {
      const key = node.kind + ':' + node.id
      if (!group.children.has(key)) group.children.set(key, { title: node.title, children: new Map(), questions: [] })
      group = group.children.get(key)!
    })
    group.questions.push({ kind: 'question', title: `${index + 1}. ${item.sourceTitle || '未命名题目'}`, index, depth: tail.length })
  })
  const rows: ReviewQueueRow[] = []
  function visit(group: Group, depth: number) {
    rows.push(...group.questions)
    group.children.forEach(child => {
      rows.push({ kind: 'heading', title: child.title, index: -1, depth })
      visit(child, depth + 1)
    })
  }
  visit(root, 0)
  return rows
}
