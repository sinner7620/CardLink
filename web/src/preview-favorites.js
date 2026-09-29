// 仅用于把旧版“按标题收藏”一次性迁移到 Core 的 recordId 收藏字段。
const FAVORITE_STORAGE_KEY = "mn-preview-favorite-titles"

export function readLegacyFavoriteTitles() {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITE_STORAGE_KEY) || "[]")
    return Array.isArray(stored) ? Array.from(new Set(stored.map(String).filter(Boolean))) : []
  } catch (_) {
    return []
  }
}

export function clearLegacyFavoriteTitles() {
  try { localStorage.removeItem(FAVORITE_STORAGE_KEY) } catch (_) {}
}
