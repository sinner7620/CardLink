export interface MineruResultItem {
  data_id?: unknown
  file_name?: unknown
  state?: unknown
  full_zip_url?: unknown
  err_msg?: unknown
  extract_progress?: { extracted_pages?: unknown; total_pages?: unknown }
}
export interface MineruDoneResult {
  dataId: string
  fileName: string
  zipUrl: string
}

function clean(value: unknown, max = 240): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

/** 官方字段为 data.extract_result；旧字段只作为历史兼容。 */
export function mineruResultItems(payload: any): MineruResultItem[] {
  const list = payload?.data?.extract_result ?? payload?.data?.file_results ?? payload?.data?.results
  if (Array.isArray(list)) return list
  return list && typeof list === "object" ? [list] : []
}

export function mineruDoneResults(payload: any): MineruDoneResult[] {
  return mineruResultItems(payload)
    .filter(item => /^(done|success)$/i.test(clean(item?.state)) && typeof item?.full_zip_url === "string" && !!clean(item.full_zip_url))
    .map(item => ({ dataId: clean(item?.data_id), fileName: clean(item?.file_name), zipUrl: clean(item.full_zip_url, 2000) }))
}

export function mineruFailureMessage(payload: any): string | undefined {
  const item = mineruResultItems(payload).find(result => /^(failed|error)$/i.test(clean(result?.state)))
  if (!item) return undefined
  return clean(item.err_msg) || clean(payload?.msg) || "解析失败"
}

export function mineruServiceError(payload: any, action: string): string | undefined {
  const raw = payload?.code
  if (raw == null || Number(raw) === 0) return undefined
  return `MinerU ${action}失败：${clean(payload?.msg) || clean(raw) || "未知错误"}`
}

export function mineruMissingDoneArchive(payload: any): boolean {
  return mineruResultItems(payload).some(item => /^(done|success)$/i.test(clean(item?.state)) && !clean(item?.full_zip_url))
}

export function mineruStateSummary(payload: any): string {
  const labels: Record<string, string> = {
    "waiting-file": "等待文件入队",
    uploading: "文件处理中",
    pending: "排队中",
    running: "解析中",
    converting: "格式转换中",
    done: "已完成",
    success: "已完成",
    failed: "失败",
    error: "失败"
  }
  const summaries = mineruResultItems(payload).map(item => {
    const state = clean(item.state).toLowerCase()
    const extracted = Number(item.extract_progress?.extracted_pages)
    const total = Number(item.extract_progress?.total_pages)
    const pages = Number.isFinite(extracted) && Number.isFinite(total) && total > 0 ? ` ${extracted}/${total}页` : ""
    return `${labels[state] || state || "状态未知"}${pages}`
  })
  return Array.from(new Set(summaries)).join("、")
}
