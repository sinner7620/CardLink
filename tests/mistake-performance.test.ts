import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("错题列表日常刷新不重新扫描全部脑图节点", () => {
  const source = readFileSync("src/mistake-manager.ts", "utf8")
  const workbench = source.slice(
    source.indexOf("export function mistakeWorkbenchData"),
    source.indexOf("export async function removeMistakesByIds")
  )

  assert.doesNotMatch(workbench, /refreshRecord\s*\(/)
  // 普通 dashboard 只读快照；标签和原卡可用性由详情、复习和手动整理核对。
  const saves = workbench.match(/saveMistakeState\s*\(/g) || []
  assert.equal(saves.length, 0)
  assert.doesNotMatch(workbench, /syncManualTagsFromSource\s*\(/)
  assert.doesNotMatch(workbench, /MN\.db\.getNoteById\s*\(/)
  assert.match(workbench, /noteAvailable: stored\.sourceAvailable !== false/)
})

test("面板启动只返回首批错题并在首屏绘制后分页续传", () => {
  const manager = readFileSync("src/mistake-manager.ts", "utf8")
  const core = readFileSync("src/rails-core.ts", "utf8")
  const ui = readFileSync("web/src/main.jsx", "utf8")

  assert.match(manager, /const WORKBENCH_PAGE_SIZE = 25/)
  assert.match(manager, /const MAX_WORKBENCH_TRANSFERS = 4/)
  assert.match(manager, /const workbenchTransfers = new Map<string, WorkbenchTransfer>\(\)/)
  assert.match(manager, /pruneWorkbenchTransfers\(now\)[\s\S]*workbenchTransfers\.set\(id/)
  assert.match(manager, /const transfer = workbenchTransfers\.get\(transferId\)/)
  assert.doesNotMatch(manager, /let workbenchTransfer:/)
  assert.match(manager, /const records = data\.records\.slice\(safeOffset, safeOffset \+ WORKBENCH_PAGE_SIZE\)/)
  assert.match(core, /mistakes: beginMistakeWorkbenchTransfer\(\)/)
  assert.match(core, /command === "mistakesPage"/)
  assert.doesNotMatch(core.slice(core.indexOf('command === "dashboard"'), core.indexOf('command === "answer"')), /mistakeWorkbenchData\(\)/)
  assert.match(ui, /setData\(next\)[\s\S]*await waitForPaint\(\)[\s\S]*MNBridge\.send\("mistakesPage"/)
  assert.match(ui, /正在载入错题/)
})

test("标签恢复只补充缺失错题，不覆盖或删除已有复习记录", () => {
  const source = readFileSync("src/mistake-manager.ts", "utf8")
  const recovery = source.slice(
    source.indexOf("async function recoverMistakesFromSourceTagsInternal"),
    source.indexOf("function recordById")
  )

  assert.match(recovery, /if \(state\.records\[recordId\]\) \{[\s\S]*existing\+\+[\s\S]*continue/)
  assert.match(recovery, /if \(added\) saveMistakeState\(state\)/)
  assert.doesNotMatch(recovery, /removeMistakeRecord\s*\(/)
})

test("错题状态启用会话缓存且不强制同步 NSUserDefaults", () => {
  const source = readFileSync("src/mistake-store.ts", "utf8")

  assert.match(source, /if \(cachedState\) return cachedState/)
  assert.doesNotMatch(source, /defaults\.synchronize\s*\(/)
})

test("跨学习集定位只派发一次官方链接，并以学习集和焦点实态确认完成", () => {
  const source = readFileSync("src/note-navigation.ts", "utf8")

  assert.doesNotMatch(source, /NAVIGATION_RETRY_ATTEMPTS/)
  assert.match(source, /跨学习集，派发唯一官方 openURL=/)
  assert.match(source, /isTargetFocused/)
  assert.doesNotMatch(source, /noteReferenceUrlCandidates/)
})

test("批量错题操作合并存储和数据库刷新", () => {
  const source = readFileSync("src/mistake-manager.ts", "utf8")
  const batchReview = source.slice(
    source.indexOf("export async function reviewMistakesByIds"),
    source.indexOf("export async function setMistakeCategoryById")
  )
  const batchRemove = source.slice(
    source.indexOf("export async function removeMistakesByIds"),
    source.indexOf("export function saveMistakeReviewCurves")
  )

  // Persistence is centralized in the shared write layer: batch operations
  // each commit once per affected notebook and save the store exactly once.
  assert.equal((batchReview.match(/saveMistakeState\s*\(/g) || []).length, 1)
  assert.equal((batchReview.match(/commitSourceTagTasks\s*\(/g) || []).length, 1)
  assert.doesNotMatch(batchReview, /persistSources\s*\(/)
  assert.equal((batchRemove.match(/saveMistakeState\s*\(/g) || []).length, 1)
  assert.equal((batchRemove.match(/commitSourceTagTasks\s*\(/g) || []).length, 1)
  assert.doesNotMatch(batchRemove, /persistSources\s*\(/)
})

test("错题浏览提供多选、批量改等级和二次确认取消", () => {
  const ui = readFileSync("web/src/main.jsx", "utf8")
  const bridge = readFileSync("src/rails-core.ts", "utf8")

  assert.match(ui, /"进入多选"/)
  assert.match(ui, /"完成多选"/)
  assert.match(ui, /action\("changeMistakeLevels"/)
  assert.match(ui, /removeArmed \? `确认取消/)
  assert.match(ui, /AnimatedCheckbox[\s\S]*onChange=\{onToggle\}/)
  assert.match(ui, /onClick=\{onPreview\}/)
  assert.match(ui, /className="batchExport"[\s\S]*onExportSelected\(selectedIds\)/)
  assert.match(ui, /className="batchLevelSelect"[\s\S]*修改等级/)
  assert.match(ui, /selecting \? `\$\{selectedIds\.length\}\/\$\{records\.length\}` : `共\$\{records\.length\}道`/)
  assert.match(ui, /className="filterCollapseButton"[\s\S]*setFiltersOpen/)
  assert.match(ui, /onExportSelected=\{openExport\}/)
  assert.match(ui, /initialRecordIds=\{exportRecordIds\}/)
  assert.match(ui, /setExportRecordIds\(Array\.isArray\(recordIds\) \? recordIds : \[\]\)/)
  assert.match(bridge, /command === "reviewMistakes"/)
  assert.match(bridge, /command === "removeMistakes"/)
})

test("工作台输出会排除三档托管标签，不把它们重新显示为自定义标签", () => {
  const manager = readFileSync("src/mistake-manager.ts", "utf8")
  assert.match(manager, /function userManualTags[\s\S]*filter\(tag => !isManagedMistakeTag\(tag\)\)/)
  assert.match(manager, /manualCategories: visibleManualTags/)
  assert.match(manager, /savedCategories = cleanMistakeTags[\s\S]*!isManagedMistakeTag/)
})

test("标签恢复的自动调度与节流基建已随手动化迁移删除", () => {
  const source = readFileSync("src/mistake-manager.ts", "utf8")
  assert.doesNotMatch(source, /LAST_FULL_TAG_RECOVERY_KEY|FULL_TAG_RECOVERY_INTERVAL/)
  assert.doesNotMatch(source, /storedFullTagRecoveryAt|rememberFullTagRecovery|lastFullTagRecoveryAt/)
  assert.doesNotMatch(source, /scheduledRecoveryTokens|nextRecoveryScheduleToken/)
  // 恢复扫描仍走串行队列且只增不删
  assert.match(source, /let tagRecoveryQueue: Promise<void> = Promise\.resolve\(\)/)
  assert.doesNotMatch(source, /已从 MarginNote 标签恢复/)
})
