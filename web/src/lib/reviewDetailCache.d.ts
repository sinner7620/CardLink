export interface ReviewDetailCache {
  get(recordId: string, version: string): Promise<any>
  clear(): void
  readonly size: number
}
export function createReviewDetailCache(
  fetchDetail: (recordId: string) => Promise<any>,
  maxEntries?: number,
  maxChars?: number
): ReviewDetailCache
