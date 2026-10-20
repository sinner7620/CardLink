/** Project independent smart progress onto the existing queue view model. */
export function fsrsQueueRecord(item, source = {}) {
  const last = item.progress.history[item.progress.history.length - 1]
  return { ...source, ...item, level: last ? last.rating - 1 : -1,
    reviewCount: item.historyCount, reviewCompleted: item.progress.paused,
    history: [], historyCount: item.historyCount,
    categoryLabel: source.categoryLabel || [item.sourceNotebookTitle, ...(item.sourcePathTitles || [])].filter(Boolean).join(" / "),
    manualCategories: item.tags, updatedAt: String(item.progress.revision) }
}
