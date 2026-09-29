// A small shared request queue: opening question + answer never requests twice.
// Keep the existing full-detail protocol; only lifetime and ownership change.
export function createReviewDetailCache(fetchDetail, maxEntries = 6, maxChars = 8 * 1024 * 1024) {
  const entries = new Map(), pending = new Map(), queue = []
  let active = 0, generation = 0, chars = 0
  function drain() {
    while (active < 2 && queue.length) {
      const job = queue.shift()
      active++
      Promise.resolve().then(job.run).finally(() => { active--; drain() })
    }
  }
  return {
    get(recordId, version) {
      const key = recordId + ':' + version
      if (entries.has(key)) {
        const entry = entries.get(key)
        entries.delete(key); entries.set(key, entry)
        return Promise.resolve(entry.detail)
      }
      if (pending.has(key)) return pending.get(key)
      const epoch = generation
      const request = new Promise((resolve, reject) => {
        queue.push({ run: async () => {
          try {
            const detail = await fetchDetail(recordId)
            const size = (detail.questionHtml?.length || 0) + (detail.answers || []).reduce((n, a) => n + (a.html?.length || 0), 0)
            if (epoch === generation && size <= maxChars) {
              entries.set(key, { detail, size }); chars += size
              while (entries.size > maxEntries || chars > maxChars) {
                const oldest = entries.keys().next().value
                chars -= entries.get(oldest).size; entries.delete(oldest)
              }
            }
            resolve(detail)
          } catch (error) { reject(error) }
          finally { if (pending.get(key) === request) pending.delete(key) }
        } })
      })
      pending.set(key, request); drain()
      return request
    },
    clear() { generation++; entries.clear(); pending.clear(); chars = 0 },
    get size() { return entries.size }
  }
}
