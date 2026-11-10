import test from "node:test"
import assert from "node:assert/strict"
import { matchesExportFilters, toggleExportFilter, type ExportFilterSelection } from "../src/export-filters"

const day = 86400000, today = new Date(2026, 10, 8).getTime()
const defaults: ExportFilterSelection = { levels: [], statuses: [], tags: [], created: [] }
const records = [
  { level: 0, createdAt: new Date(today).toISOString(), nextReviewAt: new Date(today + 1000).toISOString(), manualCategories: ["计算题", "需重做"] },
  { level: 1, createdAt: new Date(today - 3 * day).toISOString(), nextReviewAt: new Date(today - day).toISOString(), manualCategories: ["概念"] },
  { level: 2, createdAt: new Date(today - 20 * day).toISOString(), reviewCompleted: true, manualCategories: [] },
  { level: 1, createdAt: new Date(today - 40 * day).toISOString(), nextReviewAt: new Date(today + 3 * day).toISOString(), manualCategory: "需重做" }
]
const match = (filters: Partial<ExportFilterSelection>) => records.map((item, index) => matchesExportFilters(item, { ...defaults, ...filters }, today) ? index : -1).filter(index => index >= 0)

test("同组等级、复习状态、标签和时间可多选取并集", () => {
  assert.deepEqual(match({ levels: ["0", "2"] }), [0, 2])
  assert.deepEqual(match({ statuses: ["overdue", "completed"] }), [1, 2])
  assert.deepEqual(match({ tags: ["需重做", "概念"] }), [0, 1, 3])
  assert.deepEqual(match({ tags: ["untagged", "需重做"] }), [0, 2, 3])
  assert.deepEqual(match({ created: ["today", "30"] }), [0, 1, 2])
})

test("不同组取交集，不重复包含多标签命中的题目", () => {
  assert.deepEqual(match({ levels: ["0", "1"], tags: ["计算题", "需重做"], created: ["7", "today"], statuses: ["today", "overdue"] }), [0])
  assert.deepEqual(match({}), [0, 1, 2, 3])
  assert.deepEqual(match({ levels: ["2"], statuses: ["today", "upcoming"] }), [])
})

test("全部选项清除限制，逐项取消保留其余选择", () => {
  const original = ["0", "1"]
  assert.deepEqual(toggleExportFilter(original, "2"), ["0", "1", "2"])
  assert.deepEqual(toggleExportFilter(original, "0"), ["1"])
  assert.deepEqual(toggleExportFilter(original, "all"), [])
  assert.deepEqual(original, ["0", "1"])
})

test("日期范围遵守当天边界，缺少有效日期不匹配时间筛选", () => {
  for (const createdAt of ["bad", new Date(today + day).toISOString()]) {
    assert.equal(matchesExportFilters({ level: 0, createdAt }, { ...defaults, created: ["today", "7"] }, today), false)
  }
  assert.equal(matchesExportFilters({ level: 0, createdAt: "bad", nextReviewAt: "bad" }, { ...defaults, statuses: ["today", "overdue"] }, today), false)
})
