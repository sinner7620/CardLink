import { parentBranchPath } from "../../../src/source-insights"

// Use source paths, not editable category tags. Notebook and root IDs keep
// equally named maps in different scopes independent.
export function reviewSourcePath(record) {
  const notebook = record.sourceNotebookTitle || "未命名学习集"
  return [notebook, ...(record.sourceRootTitle ? [record.sourceRootTitle] : []), ...parentBranchPath(record)]
}

export function buildReviewFilterTree(records) {
  const roots = [], byKey = new Map()
  for (const record of records) {
    const titles = reviewSourcePath(record)
    let siblings = roots, keys = [record.sourceNotebookId || titles[0]]
    for (let depth = 0; depth < titles.length; depth++) {
      if (depth) keys = [...keys, depth === 1 ? record.sourceRootNodeId || titles[depth] : titles[depth]]
      const key = JSON.stringify(keys)
      let node = byKey.get(key)
      if (!node) {
        node = { key, title: titles[depth], children: [], recordIds: [] }
        siblings.push(node); byKey.set(key, node)
      }
      node.recordIds.push(record.recordId)
      siblings = node.children
    }
    siblings.push({ key: `record:${record.recordId}`, title: record.sourceTitle, children: [], recordIds: [record.recordId] })
  }
  return roots
}

// Expand the third-last level into the second-last; do not expose question leaves.
export const canExpandReviewNode = node => node.children.some(child => child.children.length > 0)

export function toggleReviewSelection(selected, ids) {
  const next = new Set(selected), remove = ids.every(id => next.has(id))
  for (const id of ids) { if (remove) next.delete(id); else next.add(id) }
  return next
}

export function reviewDayStatus(records, manualTodayIds = [], now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  const manual = new Set(manualTodayIds)
  const statusOf = item => {
    if (item.reviewCompleted) return "completed"
    const due = Date.parse(item.nextReviewAt)
    if (due < start) return manual.has(item.recordId) ? "today" : "overdue"
    return due < end ? "today" : "upcoming"
  }
  const counts = { today: 0, overdue: 0, upcoming: 0, completed: 0 }
  for (const item of records) {
    if (item.noteAvailable !== false) counts[statusOf(item)]++
  }
  return { counts, statusOf, startToday: start }
}

const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0
export function sortReviewRecords(records, order) {
  return [...records].sort((a, b) => {
    if (order === "map") return reviewSourcePath(a).join(" / ").localeCompare(reviewSourcePath(b).join(" / "), "zh-CN")
    if (order === "level") return a.level - b.level
    if (order === "added") return timestamp(b.createdAt) - timestamp(a.createdAt)
    if (order === "reviewed") return timestamp(b.lastReviewedAt) - timestamp(a.lastReviewedAt)
    return timestamp(a.nextReviewAt) - timestamp(b.nextReviewAt)
  })
}


// null means an unfiltered queue, not a user's explicit selection.
export function chooseReviewSources(current, ids) {
  return current === null ? new Set(ids) : toggleReviewSelection(current, ids)
}
export function chooseReviewLevels(current, level) {
  return current === null ? [level] : current.includes(level) ? current.filter(item => item !== level) : [...current, level]
}
