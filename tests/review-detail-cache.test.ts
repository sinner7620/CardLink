import test from "node:test"
import assert from "node:assert/strict"
import { createReviewDetailCache } from "../web/src/lib/reviewDetailCache.js"

test("复习详情相同请求去重且缓存有界", async () => {
  let calls = 0
  const cache = createReviewDetailCache(async (recordId: string) => {
    calls++
    return { questionHtml: recordId, answers: [{ html: recordId }] }
  }, 2, 1000)
  const [a, duplicate] = await Promise.all([cache.get("a", "1"), cache.get("a", "1")])
  assert.equal(a, duplicate)
  assert.equal(calls, 1)
  await cache.get("b", "1"); await cache.get("c", "1")
  assert.equal(cache.size, 2)
  await cache.get("a", "1")
  assert.equal(calls, 4, "最早的 a 应已被 LRU 淘汰")
})

test("复习详情桥请求最多两个并发", async () => {
  let active = 0, peak = 0
  const releases: Array<() => void> = []
  const cache = createReviewDetailCache(() => new Promise(resolve => {
    active++; peak = Math.max(peak, active)
    releases.push(() => { active--; resolve({ questionHtml: "", answers: [] }) })
  }))
  const jobs = ["a", "b", "c", "d"].map(id => cache.get(id, "1"))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(peak, 2)
  while (releases.length) { releases.shift()!(); await new Promise(resolve => setTimeout(resolve, 0)) }
  await Promise.all(jobs)
  assert.equal(peak, 2)
})
