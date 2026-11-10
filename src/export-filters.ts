export interface ExportFilterSelection {
  levels: string[]
  statuses: string[]
  created: string[]
  tags: string[]
}

interface FilterRecord {
  level: number
  nextReviewAt?: string
  reviewCompleted?: boolean
  createdAt: string
  manualCategories?: string[]
  manualCategory?: string
  reasonTags?: string[]
}

export function filterableMistakeTags(item: Pick<FilterRecord, "manualCategories" | "manualCategory" | "reasonTags">): string[] {
  return [...(item.manualCategories?.length ? item.manualCategories : item.manualCategory ? [item.manualCategory] : []), ...(item.reasonTags ?? [])]
}

/** An empty group means unrestricted. Choices within a group form a union. */
export function matchesExportFilters(item: FilterRecord, filters: ExportFilterSelection, startToday: number): boolean {
  const endToday = startToday + 86400000
  if (filters.levels.length && !filters.levels.includes(String(item.level))) return false
  if (filters.statuses.length && !filters.statuses.some(status => {
    if (status === "completed") return item.reviewCompleted === true
    if (item.reviewCompleted) return false
    const due = new Date(item.nextReviewAt || "").getTime()
    if (status === "today") return due >= startToday && due < endToday
    if (status === "overdue") return due < startToday
    if (status === "upcoming") return due >= endToday
    return false
  })) return false
  if (filters.tags.length) {
    const tags = filterableMistakeTags(item)
    if (!filters.tags.some(tag => tag === "untagged" ? tags.length === 0 : tags.includes(tag))) return false
  }
  if (filters.created.length) {
    const created = new Date(item.createdAt).getTime()
    if (!filters.created.some(period => {
      const days = period === "today" ? 1 : period === "7" ? 7 : period === "30" ? 30 : 0
      return days > 0 && created >= startToday - (days - 1) * 86400000 && created < endToday
    })) return false
  }
  return true
}

export function toggleExportFilter(values: string[], value: string): string[] {
  if (value === "all") return []
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value]
}
