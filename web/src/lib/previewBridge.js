import { escapeHtml } from "../../../src/html-utils"
import { ocrPreview } from './ocrPreview'

const previewCredentials={'ocr-glm':'preview-only-c913'}
let previewOCREngine='glm-ocr'
const DAY = 86400000
const levelCurves = [[1, 3, 7], [2, 5, 10], [14]]
let customCategories = ["计算题", "概念辨析", "需要重做"]
let debugAnswerPreviewMode = "custom"
let debugModeEnabled = false
let debugAiAnalysisEnabled = false
let reviewAlgorithm = "fixed"
let debugUpdateDownloadsEnabled = false
let debugAutoInstallUpdatesEnabled = false
let pluginEnabled = true
let previewClipper = { mode: false, running: false, started: false, excerptTitle: true, toolLabels: {} }
let sourceLocateMode = "locate"
let previewPersonalSettings = { globalQuestionColors: [], entranceDefaultMode: "practice", boundHandwritingDisplay: "doubleTap", answerInkEnabled: false, mistakeListDisplay: "always", subcardAnswerDisplay: "window", answerMaskStyle: "dark", answerMaskColor: "#141922", maskImageConfigured: false, autoCollapseComments: false, reviewExpandedCommentCount: 2, reviewCompletionConfetti: true }
let manualTodayIds = []
let previewBindings = [
  { key: "questions::root::main", notebookId: "questions", notebookTitle: "多元微分", sourceRootNodeId: "main", sourceTitle: "考研真题", answerTitle: "多元微分答案 › 标准答案", hasAnswerMindMap: true, selectionMode: "designated", designatedAnswer: "mindmap", questionColors: [1], availableColors: [0, 1, 2, 3] },
  { key: "practice::root::main", notebookId: "practice", notebookTitle: "强化练习", sourceRootNodeId: "main", sourceTitle: "方向导数", answerTitle: "—", hasAnswerMindMap: false, selectionMode: "designated", designatedAnswer: "subcard", questionColors: [2], availableColors: [0, 2, 4] }
]

function endOfTodayTs(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
}

function dateFromNow(days) {
  return new Date(Date.now() + days * DAY).toISOString()
}

const records = [
  {
    recordId: "questions:q1",
    sourceNoteId: "q1",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "1994数一",
    sourcePathTitles: ["基本概念题", "偏导与连续"],
    categoryPath: ["多元微分", "基本概念题", "偏导与连续"],
    categoryLabel: "多元微分 › 基本概念题 › 偏导与连续",
    categoryKeys: [],
    manualCategories: ["概念辨析", "需要重做"],
    manualCategory: "概念辨析",
    favorite: true,
    level: 0,
    createdAt: dateFromNow(-6),
    updatedAt: dateFromNow(-2),
    lastReviewedAt: dateFromNow(-2),
    nextReviewAt: dateFromNow(-1),
    reviewCount: 1,
    history: [
      { at: dateFromNow(-120), level: 0 }, { at: dateFromNow(-92), level: 1 },
      { at: dateFromNow(-70), level: 0 }, { at: dateFromNow(-55), level: 1 },
      { at: dateFromNow(-42), level: 1 }, { at: dateFromNow(-31), level: 2 },
      { at: dateFromNow(-24), level: 1 }, { at: dateFromNow(-18), level: 2 },
      { at: dateFromNow(-13), level: 1 }, { at: dateFromNow(-9), level: 2 },
      { at: dateFromNow(-6), level: 0 }, { at: dateFromNow(-2), level: 0 }
    ],
    noteAvailable: true
  },
  {
    recordId: "questions:q2",
    sourceNoteId: "q2",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "2002数一 · 条件极值",
    sourcePathTitles: ["极值问题", "条件极值"],
    categoryPath: ["多元微分", "极值问题", "条件极值"],
    categoryLabel: "多元微分 › 极值问题 › 条件极值",
    categoryKeys: [],
    manualCategories: ["计算题", "条件极值"],
    manualCategory: "计算题",
    level: 1,
    createdAt: dateFromNow(-4),
    updatedAt: dateFromNow(-3),
    lastReviewedAt: dateFromNow(-3),
    nextReviewAt: dateFromNow(-0.1),
    reviewCount: 0,
    history: [{ at: dateFromNow(-4), level: 1 }],
    noteAvailable: true
  },
  {
    recordId: "practice:q3",
    sourceNoteId: "q3",
    sourceNotebookId: "practice",
    sourceNotebookTitle: "强化练习",
    sourceTitle: "26版660第239题 · 方向导数",
    sourcePathTitles: ["多元微分", "方向导数"],
    categoryPath: ["强化练习", "多元微分", "方向导数"],
    categoryLabel: "强化练习 › 多元微分 › 方向导数",
    categoryKeys: [],
    level: 1,
    createdAt: dateFromNow(-3),
    updatedAt: dateFromNow(-1),
    lastReviewedAt: dateFromNow(-1),
    nextReviewAt: dateFromNow(5),
    reviewCount: 0,
    history: [{ at: dateFromNow(-3), level: 1 }],
    noteAvailable: true
  },
  {
    recordId: "questions:q4",
    sourceNoteId: "q4",
    sourceNotebookId: "questions",
    sourceNotebookTitle: "多元微分",
    sourceTitle: "2010数一 · 隐函数二阶偏导",
    sourcePathTitles: ["隐函数", "高阶偏导"],
    categoryPath: ["多元微分", "隐函数", "高阶偏导"],
    categoryLabel: "多元微分 › 隐函数 › 高阶偏导",
    categoryKeys: [],
    level: 2,
    createdAt: dateFromNow(-20),
    updatedAt: dateFromNow(-10),
    lastReviewedAt: dateFromNow(-10),
    nextReviewAt: dateFromNow(20),
    reviewCount: 1,
    history: [{ at: dateFromNow(-20), level: 2 }],
    noteAvailable: true
  },
  {
    recordId: "past:q5",
    sourceNoteId: "q5",
    sourceNotebookId: "past",
    sourceNotebookTitle: "真题分类",
    sourceTitle: "2018数一 · 二重积分换元",
    sourcePathTitles: ["重积分", "变量替换"],
    categoryPath: ["真题分类", "重积分", "变量替换"],
    categoryLabel: "真题分类 › 重积分 › 变量替换",
    categoryKeys: [],
    level: 2,
    createdAt: dateFromNow(-80),
    updatedAt: dateFromNow(-18),
    lastReviewedAt: dateFromNow(-18),
    nextReviewAt: dateFromNow(42),
    reviewCount: 2,
    history: [{ at: dateFromNow(-80), level: 2 }, { at: dateFromNow(-18), level: 2 }],
    reviewCompleted: true,
    noteAvailable: true
  }
]

function workbench() {
  const now = Date.now()
  const today = new Date()
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const endToday = startToday + 86400000
  return {
    records,
    dueCount: records.filter(record => record.noteAvailable && !record.reviewCompleted && new Date(record.nextReviewAt).getTime() < endToday).length,
    todayDueCount: records.filter(record => {
      const dueAt = new Date(record.nextReviewAt).getTime()
      return record.noteAvailable && !record.reviewCompleted && dueAt >= startToday && dueAt < endToday
    }).length,
    levelCounts: [0, 1, 2].map(level => records.filter(record => record.level === level).length),
    categories: [],
    migratedFromLegacy: 0,
    reviewCurves: { 0: [1, 3, 7], 1: [2, 5, 10], 2: [14] },
    customCategories
  }
}

const questionHtml = `<!doctype html><html><body style="font-family:-apple-system;padding:24px;color:#1f2937"><h2>1994数一</h2><p>设二元函数 f(x,y) 在点 (x₀,y₀) 处的两个偏导数存在，判断该函数在该点连续的充分性与必要性。</p><div style="margin-top:20px;padding:18px;background:#f5f7fb;border-radius:12px">这里显示 MarginNote 原题卡片的完整摘录、图片、评论与手写内容。</div></body></html>`
const answerHtml = `<!doctype html><html><body style="font-family:-apple-system;padding:24px;color:#1f2937"><h2>实时答案</h2><p>两个偏导数存在，既不是函数在该点连续的充分条件，也不是必要条件。</p><div style="margin-top:20px;padding:18px;background:#f4f8f5;border-radius:12px">实际插件会从原题脑图当前绑定的答案脑图读取完整答案卡片。</div></body></html>`

function questionHtmlFor(record) {
  const title = escapeHtml(record.sourceTitle)
  const path = escapeHtml(record.sourcePathTitles.join(" › "))
  return `<!doctype html><html><body style="font-family:-apple-system;padding:24px;color:#1f2937"><h2>${title}</h2><p>本题完整原题卡片内容，所属章节：${path}。</p><div style="margin-top:20px;padding:18px;background:#f5f7fb;border-radius:12px">实际插件会读取该错题在 MarginNote 中的完整摘录、图片、评论与手写内容。</div></body></html>`
}

function detail(recordId) {
  const record = records.find(item => item.recordId === recordId)
  if (!record) throw new Error("错题记录不存在")
  return {
    record,
    questionHtml: questionHtmlFor(record),
    linkedQuestions: records[0] === record ? records.slice(1, 4).map(linked => ({
      noteId: linked.sourceNoteId,
      recordId: linked.recordId,
      title: linked.sourceTitle,
    })) : [],
    // 首条记录预置两个答案：验证多答案切换控件
    answers: [
      { id: `answer:${record.sourceNoteId}`, title: `${record.sourceTitle} · 标准答案`, path: "答案脑图 › 标准答案", html: answerHtml },
      ...(records[0] === record ? [{ id: `answer:${record.sourceNoteId}:alt`, title: `${record.sourceTitle} · 解法二`, path: "答案脑图 › 解法二", html: answerHtml.replace("实时答案", "解法二") }] : [])
    ],
    answerStatus: "ready"
  }
}

function workbenchPage(offset = 0, transferId = "preview-workbench") {
  const data = workbench()
  const pageSize = 25
  const safeOffset = Math.max(0, Number(offset) || 0)
  const pageRecords = data.records.slice(safeOffset, safeOffset + pageSize)
  const consumed = safeOffset + pageRecords.length
  const recordsComplete = consumed >= data.records.length
  return {
    ...data,
    records: pageRecords,
    transferId,
    totalCount: data.records.length,
    nextOffset: recordsComplete ? undefined : consumed,
    recordsComplete
  }
}

let localCachePreview = [
  { id: "indexes", title: "答案索引", clearable: false, files: 3, bytes: 2500000, documentKnownBytes: 0, documentFiles: 0 },
  { id: "pdf", title: "PDF 预览与导出图片暂存", clearable: true, files: 20, bytes: 175921800, documentKnownBytes: 175000000, documentFiles: 15 },
  { id: "logs", title: "诊断日志", clearable: true, files: 1, bytes: 695800, documentKnownBytes: 0, documentFiles: 0 },
  { id: "templates", title: "模板临时文件", clearable: true, files: 2, bytes: 494500, documentKnownBytes: 0, documentFiles: 0 },
  { id: "exports", title: "导出文件", clearable: true, files: 5, bytes: 10000000, documentKnownBytes: 10000000, documentFiles: 5 },
  { id: "saved", title: "手写与 AI", clearable: false, files: 200, bytes: 25000000, documentKnownBytes: 25000000, documentFiles: 200 },
  { id: "dataBackups", title: "插件数据备份", clearable: false, files: 2, bytes: 1200000, documentKnownBytes: 1200000, documentFiles: 2 },
  { id: "ocrDatabase", title: "OCR 数据库", clearable: false, files: 1, bytes: 4000000, documentKnownBytes: 4000000, documentFiles: 1 },
  { id: "ocrBackups", title: "OCR 数据库备份", clearable: false, files: 2, bytes: 8000000, documentKnownBytes: 8000000, documentFiles: 2 },
  { id: "updates", title: "更新包与恢复备份", clearable: true, files: 30, bytes: 10000000, documentKnownBytes: 0, documentFiles: 0 },
  { id: "other", title: "其他本地文件", clearable: false, files: 2, bytes: 808185, documentKnownBytes: 808185, documentFiles: 2 },
  { id: "recycle", title: "回收站（待手动删除）", clearable: false, files: 0, bytes: 0, documentKnownBytes: 0, documentFiles: 0, recyclePath: "/Documents/CardLink/回收站" }
].map(group => ({ ...group, knownBytes: group.bytes, documentBytes: group.documentKnownBytes, paths: [], scanRoots: ["/Documents/CardLink", "/Caches/CardLink", "/tmp/CardLink"] }))

// Browser-only samples exercise the same accepted-task / progress / result contract.
let previewCacheTask = null
function previewCacheStatus(taskId) {
  const task = previewCacheTask
  if (!task || task.taskId !== taskId) throw new Error("缓存任务已失效")
  const elapsed = Date.now() - task.started, duration = task.operation === "clear" ? 1600 : 800
  if (task.status === "running") {
    task.progress = { phase: task.operation === "scan" || elapsed < 400 ? "scan" : elapsed < 1200 ? "clear" : "verify", directories: Math.min(12, Math.floor(elapsed / 70)), visited: Math.min(263, Math.floor(elapsed / 3)), processed: Math.min(26, Math.floor(elapsed / 50)), total: 26, removed: 0, failed: 0, skipped: 0 }
    if (elapsed >= duration) {
      let removed = 0
      if (task.operation === "clear") {
        removed = localCachePreview.filter(group => task.payload.ids.includes(group.id)).reduce((sum, group) => sum + group.files, 0)
        const bytes = localCachePreview.filter(group => task.payload.ids.includes(group.id)).reduce((sum, group) => sum + group.bytes, 0)
        const recycle = localCachePreview.find(group => group.id === "recycle")
        recycle.files += removed; recycle.bytes += bytes; recycle.knownBytes = recycle.bytes; recycle.documentFiles = recycle.files; recycle.documentKnownBytes = recycle.bytes; recycle.documentBytes = recycle.bytes
        localCachePreview = localCachePreview.map(group => task.payload.ids.includes(group.id) ? { ...group, files: 0, bytes: 0, knownBytes: 0, documentFiles: 0, documentBytes: 0, documentKnownBytes: 0 } : group)
      }
      task.status = "done"
      task.result = { groups: localCachePreview.map(group => ({ ...group })), removed, failed: 0, skipped: 0, failures: [], scanIncomplete: false }
    }
  }
  return { ...task, progress: { ...task.progress } }
}

export async function previewSend(command, payload = null) {
  if (command.startsWith('ocrDb')) return ocrPreview(command,payload,records)
  if (command === "scanLocalCache" || command === "clearLocalCache") {
    if (previewCacheTask?.status === "running") return previewCacheStatus(previewCacheTask.taskId)
    if (command === "clearLocalCache" && payload.ids.some(id => !localCachePreview.some(group => group.id === id && group.id !== "recycle" && group.id !== "ocrDatabase" && (group.clearable || payload.allowRetained === true)))) throw new Error("删除保留文件需要明确确认")
    previewCacheTask = { taskId: `preview-cache-${Date.now()}`, operation: command === "clearLocalCache" ? "clear" : "scan", status: "running", started: Date.now(), payload,
      progress: { phase: "scan", directories: 0, visited: 0, processed: 0, total: 0, removed: 0, failed: 0, skipped: 0 } }
    return { ...previewCacheTask }
  }
  if (command === "localCacheTaskStatus") return previewCacheStatus(payload.taskId)

  if (debugModeEnabled && reviewAlgorithm === "fsrs" && ["saveMistakeReviewCurves", "reviewMistake", "changeMistakeLevel", "reviewMistakes", "changeMistakeLevels", "resumeMistakeReview"].includes(command)) throw new Error("FSRS 模式下固定曲线只读，请在待复习中提交反馈")
  if (command === "setReviewAlgorithm") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    if (!["fixed", "fsrs"].includes(payload?.algorithm)) throw new Error("无效的算法")
    if (payload.algorithm === "fsrs") (await import("./fsrsPreview")).fsrsPreview("initialize", null, records)
    reviewAlgorithm = payload.algorithm
    return { algorithm: reviewAlgorithm }
  }
  if (command.startsWith("fsrs")) {
    if (!debugModeEnabled || reviewAlgorithm !== "fsrs") throw new Error("请先开启调试模式和智能复习")
    if (command === "fsrsContent") return detail(payload.recordId)
    return (await import("./fsrsPreview")).fsrsPreview(command, payload, records)
  }
  if (command === "startFsrsReviewMode") throw new Error("原生复习模式需要在 MarginNote 中使用")
  if (command === "mistakesRevision") return { revision: workbench().revision || "preview" }
  // AI 配置页与总览 AI 面板的预览 mock：形状与原生 publicSettings/报告索引一致。
  if(command==='ocrReadCredential')return {value:previewCredentials[payload.credentialRef]||''}
  if(command==='ocrSetCredential'){previewCredentials[payload.credentialRef]=payload.value||previewCredentials[payload.credentialRef]||'';return {configured:!!previewCredentials[payload.credentialRef]}}
  if(command==='ocrClearCredential'){delete previewCredentials[payload.credentialRef];return {configured:false}}
  if (command === "ocrGetSettings") return {
    ocrEngine: previewOCREngine,
    mineru: { enabled: true, baseUrl: "https://mineru.net", credentialRef: "ocr-mineru", model: "vlm", language: "ch", enableFormula: true, enableTable: true, policy: "auto" },
    glmOcr: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", credentialRef: "ocr-glm", model: "glm-ocr", timeoutMs: 120000 },
    credentials: {
      "ocr-mineru": { configured: !!previewCredentials['ocr-mineru'], persistence: "local", maskedSuffix: (previewCredentials['ocr-mineru']||'').slice(-4) },
      "ocr-glm": { configured: !!previewCredentials['ocr-glm'], persistence: "local", maskedSuffix: (previewCredentials['ocr-glm']||'').slice(-4) }
    }
  }
  if (command === "ocrSaveSettings") {if(payload.ocrEngine)previewOCREngine=payload.ocrEngine;return payload}
  if (command === "ocrListMistakeStudySets") return [{ id: "questions", title: "高等数学题集", mistakeCount: 2 }, { id: "practice", title: "强化练习", mistakeCount: 1 }]
  if (command === "refreshMistakeList") return { refreshed: 0 }
  if (command === "dashboard") return {
    reviewAlgorithm: debugModeEnabled ? reviewAlgorithm : "fixed",
    clipper: previewClipper,
    version: "2.4.0 · 完整界面预览",
    mistakes: workbenchPage(),
    manualTodayIds,
    matching: {
      scopedBinding: true,
      mode: "title",
      matchedGroups: 0,
      pairs: 0,
      regexRules: { questionPattern: "", answerPattern: "" },
      debugModeEnabled,
      debugAiAnalysisEnabled,
      debugUpdateDownloadsEnabled,
      debugAnswerPreviewMode,
      debugAutoInstallUpdatesEnabled,
      pluginEnabled,
      sourceLocateMode,
      ...previewPersonalSettings
    },
    answerBindings: previewBindings
  }
  if (command === "bindingSettingsSnapshot") {
    const dashboard = await previewSend("dashboard")
    return { matching: dashboard.matching, answerBindings: previewBindings, clipper: previewClipper }
  }
  if (command === "setClipperTitle") { previewClipper = { ...previewClipper, excerptTitle: payload?.enabled === true }; return previewClipper }
  if (command === "setClipperAnswer") { previewClipper = { ...previewClipper, excerptAnswer: payload?.enabled === true }; return previewClipper }
  if (command === "recordClipperTool") throw new Error("请在 MarginNote 中选择并记录摘录工具")
  if (command === "openClipperMode") throw new Error("请在 MarginNote 中打开文档后使用摘题快捷区")
  if (command === "chooseClipperAnswerPosition") throw new Error("请在 MarginNote 中选择答案位置（目前支持子卡片）")
  if (command === "configureClipperTitleFormat") throw new Error("请在 MarginNote 中设置标题格式：原始标题、统一前缀、母卡标题前缀或母卡内自动题号")
  if (command === "setPersonalSetting") {
    if (payload?.key === "debugAiAnalysisEnabled") {
      if (!debugModeEnabled || typeof payload?.value !== "boolean") throw new Error("请先开启调试模式")
      debugAiAnalysisEnabled = payload.value
    }
    else if (payload?.key === "answerMaskImage") previewPersonalSettings.maskImageConfigured = Boolean(payload.value)
    else if (payload?.key === "answerMaskColor") { previewPersonalSettings.answerMaskColor = payload.value; previewPersonalSettings.maskImageConfigured = false }
    else previewPersonalSettings[payload?.key] = payload?.value
    return (await previewSend("dashboard")).matching
  }
  if (command === "chooseReviewCommentCount") return (await previewSend("dashboard")).matching
  if (command === "updateManagedAnswerBinding") {
    previewBindings = previewBindings.map(row => row.key === payload?.key ? { ...row, ...payload?.changes } : row)
    return { updated: true }
  }
  if (command === "deleteManagedAnswerBinding") {
    previewBindings = previewBindings.filter(row => row.key !== payload?.key)
    return { deleted: true }
  }
  if (command === "addGlobalAnswerBindingColor") {
    previewPersonalSettings.globalQuestionColors = [...new Set([...previewPersonalSettings.globalQuestionColors, 3])]
    return { color: 3 }
  }
  if (command === "addManagedAnswerBindingColor") {
    const color = 3
    previewBindings = previewBindings.map(row => row.key === payload?.key ? { ...row, questionColors: [...new Set([...row.questionColors, color])] } : row)
    return { color }
  }
  if (command === "refreshManagedAnswerBinding" || command === "chooseManagedAnswerMindMap") return { preview: true }
  if (command === "mistakes") return workbenchPage()
  if (command === "mistakesPage") return workbenchPage(payload?.offset, String(payload?.transferId || "preview-workbench"))
  if (command === "addManualTodayOverdue") {
    const startToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
    const pool = records.filter(item => !item.reviewCompleted && new Date(item.nextReviewAt).getTime() < startToday && !manualTodayIds.includes(item.recordId))
    const added = pool.slice(0, Math.max(0, Math.min(5, Number(payload?.count) || 0))).map(item => item.recordId)
    manualTodayIds = [...manualTodayIds, ...added]
    return { ids: manualTodayIds, addedCount: added.length }
  }
  if (command === "testTelemetryConnectivity") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    return {
      test: true,
      testedAt: new Date().toISOString(),
      results: [
        { key: "测试1", reachable: true, accepted: true, statusCode: 204, durationMs: 12 },
        { key: "测试2", reachable: true, accepted: true, statusCode: 204, durationMs: 30 }
      ]
    }
  }
  if (command === "setDebugMode") {
    debugModeEnabled = payload?.enabled === true
    if (!debugModeEnabled) { debugAiAnalysisEnabled = false; debugUpdateDownloadsEnabled = false; debugAutoInstallUpdatesEnabled = false }
    return { enabled: debugModeEnabled, algorithm: debugModeEnabled ? reviewAlgorithm : "fixed" }
  }
  if (command === "chooseAnswerPreviewMode") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    debugAnswerPreviewMode = debugAnswerPreviewMode === "native" ? "custom" : "native"
    return { debugAnswerPreviewMode }
  }
  if (command === "setDebugUpdateDownloads") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    debugUpdateDownloadsEnabled = payload?.enabled === true
    return { debugUpdateDownloadsEnabled }
  }
  if (command === "showUpdateStatus") return { preview: true }
  if (command === "updateChoice") return { accepted: ["direct", "manual", "later"].includes(payload?.choice) }
  if (command === "pendingUpdatePrompt") return null
  if (command === "setDebugAutoInstallUpdates") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    debugAutoInstallUpdatesEnabled = payload?.enabled === true
    return { debugAutoInstallUpdatesEnabled }
  }
  if (command === "setPluginEnabled") {
    pluginEnabled = payload?.enabled === true
    return { enabled: pluginEnabled }
  }
  if (command === "mistakeDetail") {
    const value = detail(String(payload?.recordId ?? ""))
    if (payload?.content === "question") return { ...value, answers: [], answerStatus: "deferred" }
    if (payload?.content === "answers") return { ...value, questionHtml: "" }
    return value
  }
  if (command === "mistakeQuestion") {
    const value = detail(String(payload?.recordId ?? ""))
    return { questionHtml: value.questionHtml }
  }
  if (command === "openMistakeHandwriting") {
    throw new Error("浏览器预览无法打开 MarginNote 原生手写板，请在支持场景插件的 MarginNote 中使用")
  }
  if (command === "chooseSourceLocateMode") {
    sourceLocateMode = sourceLocateMode === "focus" ? "locate" : "focus"
    return { mode: sourceLocateMode }
  }
  if (command === "setMistakeFavorite") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (!record) throw new Error("错题记录不存在")
    record.favorite = payload?.favorite === true
    return record
  }
  if (command === "migrateLegacyFavorites") {
    const titles = new Set(Array.isArray(payload?.titles) ? payload.titles.map(String) : [])
    let migrated = 0
    let ambiguous = 0
    for (const title of titles) {
      const matches = records.filter(item => item.sourceTitle === title)
      if (matches.length === 1) { matches[0].favorite = true; migrated++ }
      else if (matches.length > 1) ambiguous++
    }
    return { migrated, ambiguous }
  }
  if (command === "reviewMistake") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (!record) throw new Error("错题记录不存在")
    manualTodayIds = manualTodayIds.filter(id => id !== record.recordId)
    const nextLevel = Math.max(0, Math.min(2, Number(payload?.level) || 0))
    const sameLevel = nextLevel === record.level
    record.reviewCount = sameLevel ? record.reviewCount + 1 : 0
    record.level = nextLevel
    record.lastReviewedAt = new Date().toISOString()
    record.updatedAt = record.lastReviewedAt
    record.nextReviewAt = dateFromNow(levelCurves[record.level][Math.min(record.reviewCount, levelCurves[record.level].length - 1)])
    record.reviewCompleted = record.level === 2 && sameLevel && record.reviewCount >= 1
    record.history = [...(record.history || []), { at: record.updatedAt, level: record.level }]
    return record
  }
  if (command === "changeMistakeLevel") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (!record) throw new Error("错题记录不存在")
    const nextLevel = Math.max(0, Math.min(2, Number(payload?.level) || 0))
    if (nextLevel === record.level) return record
    record.level = nextLevel
    record.reviewCount = 0
    record.reviewCompleted = false
    record.updatedAt = new Date().toISOString()
    record.nextReviewAt = dateFromNow(levelCurves[nextLevel][0])
    record.history = [...(record.history || []), { at: record.updatedAt, level: nextLevel }]
    return record
  }
  if (command === "reviewMistakes" || command === "changeMistakeLevels") {
    const ids = new Set((payload?.recordIds || []).map(String))
    const changed = []
    for (const record of records) {
      if (!ids.has(record.recordId)) continue
      const nextLevel = Math.max(0, Math.min(2, Number(payload?.level) || 0))
      if (nextLevel === record.level) continue
      record.level = nextLevel
      record.lastReviewedAt = new Date().toISOString()
      record.updatedAt = record.lastReviewedAt
      record.nextReviewAt = dateFromNow(levelCurves[record.level][0])
      record.reviewCount = 0
      record.reviewCompleted = false
      changed.push(record)
    }
    return { changed: changed.length, missing: ids.size - changed.length, records: changed }
  }
  if (command === "resumeMistakeReview") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (!record) throw new Error("错题记录不存在")
    record.reviewCompleted = false
    record.reviewCount = 0
    record.updatedAt = new Date().toISOString()
    record.nextReviewAt = dateFromNow(levelCurves[record.level][0])
    return record
  }
  if (command === "setMistakeCategory") {
    const record = records.find(item => item.recordId === String(payload?.recordId ?? ""))
    if (record) {
      const next = Array.isArray(payload?.categories) ? payload.categories.map(String) : [String(payload?.category ?? "")].filter(Boolean)
      record.manualCategories = [...new Set(next)]
      record.manualCategory = record.manualCategories[0]
      customCategories = [...new Set([...customCategories, ...record.manualCategories])]
    }
    return record
  }
  if (command === "deleteMistakeTag") {
    const tag = String(payload?.tag ?? "")
    customCategories = customCategories.filter(item => item !== tag)
    let changed = 0
    for (const record of records) {
      const previous = record.manualCategories || (record.manualCategory ? [record.manualCategory] : [])
      if (!previous.includes(tag)) continue
      record.manualCategories = previous.filter(item => item !== tag)
      record.manualCategory = record.manualCategories[0]
      changed++
    }
    return { tag, changed }
  }
  if (command === "removeMistake") {
    const index = records.findIndex(item => item.recordId === String(payload?.recordId ?? ""))
    if (index >= 0) records.splice(index, 1)
    return { removed: true }
  }
  if (command === "removeMistakes") {
    const ids = new Set((payload?.recordIds || []).map(String))
    const removed = []
    for (let index = records.length - 1; index >= 0; index--) {
      if (!ids.has(records[index].recordId)) continue
      removed.push(...records.splice(index, 1))
    }
    return { changed: removed.length, missing: ids.size - removed.length, records: removed }
  }
  if (command === "saveMistakeReviewCurves") return payload?.curves || workbench().reviewCurves
  if (command === "previewMistakeExport") {
    // 与真机契约一致：recordIds 为严格白名单，空数组 = 零道，绝不回退成全部
    const exportIds = (payload?.recordIds || []).map(String)
    const all = exportIds.flatMap(id => records.find(item => item.recordId === id) || [])
    const chosen = all.slice(0, 3)
    if (!chosen.length) throw new Error("当前预览范围没有可用错题")
    const exportInclude = { handwriting: false, comments: false, ...(payload?.include || {}) }
    const exportExtras = `${exportInclude.handwriting ? '<section aria-label="脑图绑定书写">脑图绑定书写示例</section>' : ''}${exportInclude.comments ? `<details class="card-comment" open><summary>评论</summary><p>卡片子评论示例</p>${exportInclude.handwriting ? '<p>评论书写示例</p>' : ''}</details>` : ''}`
    if (payload?.format === "md") {
      const markdown = [`# MN4 错题导出`, "", ...chosen.flatMap((item, index) => [`## ${index + 1}. ${item.sourceTitle}`, "", `来源：${item.sourceNotebookTitle} › ${item.sourcePathTitles.join(" › ")}`, "", "### 原题卡片", "", "题目卡片正文", "", "### 实时匹配答案", "", "答案卡片正文", "", "---", ""])]
      if (exportExtras) markdown.push(exportExtras)
      return { preview: true, format: "md", count: all.length, previewCount: chosen.length, truncated: all.length > chosen.length, markdown: markdown.join("\n") }
    }
    const include = { question: true, answer: true, source: true, review: false, ...(payload?.include || {}) }
    const question = (item, index) => `<article class="mistake question-unit"><header><b>${index + 1}.</b><h1>${item.sourceTitle}</h1></header>${include.source ? `<small>来源：${item.sourceNotebookTitle} › ${item.sourcePathTitles.join(" › ")}</small>` : ""}${include.question ? `<div class="card">${questionHtml}${exportExtras}</div>` : ""}<div class="writing-space"></div></article>`
    const answer = (item, index) => `<article class="mistake answer-unit"><header><b>答案 ${index + 1}</b><h1>${item.sourceTitle}</h1></header><div class="card">${answerHtml}${exportExtras}</div></article>`
    const questions = chosen.map(question)
    const answers = include.answer ? chosen.map(answer) : []
    const perPage = payload?.pageLayout === "one-per-page" ? 1 : payload?.pageLayout === "two-per-page" ? 2 : payload?.pageLayout === "three-per-page" ? 3 : 0
    const flow = (blocks, className) => blocks.length ? `<section class="pdf-flow ${className}">${blocks.map(block => `<div class="pdf-slot">${block}</div>`).join("")}</section>` : ""
    let content
    if (!perPage) {
      const blocks = payload?.answerLayout === "end" ? [...questions, ...answers] : chosen.map((item, index) => `${question(item, index)}${include.answer ? answer(item, index) : ""}`)
      content = flow(blocks, "pdf-compact-flow")
    }
    else {
      const pages = Array.from({ length: Math.ceil(questions.length / perPage) }, (_, page) => {
        const start = page * perPage
        const pageQuestions = questions.slice(start, start + perPage)
        const questionPage = `<section class="pdf-page slots-${perPage}">${pageQuestions.map(block => `<div class="pdf-slot">${block}</div>`).join("")}</section>`
        return payload?.answerLayout === "after-each" ? questionPage + flow(answers.slice(start, start + pageQuestions.length), "pdf-answer-flow") : questionPage
      })
      content = pages.join("") + (payload?.answerLayout === "end" ? flow(answers, "pdf-answer-flow") : "")
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:#fff}body{width:186mm;font:12px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#172033}.pdf-flow .pdf-slot+.pdf-slot{margin-top:1.55em}.pdf-flow{width:186mm}.pdf-answer-flow{padding:2mm 1mm}.pdf-page{width:186mm;min-height:273mm;display:grid}.slots-1{grid-template-rows:1fr}.slots-2{grid-template-rows:repeat(2,minmax(0,1fr))}.slots-3{grid-template-rows:repeat(3,minmax(0,1fr))}.pdf-page .pdf-slot{padding:3mm 1mm}.mistake{padding:3mm 1mm}.mistake header{display:flex;align-items:baseline;gap:8px}.mistake h1{font-size:18px;margin:0}.mistake small{color:#7b8494}.card{margin-top:8px;padding:12px;background:#f4f6f9;border-radius:6px}.writing-space{height:${payload?.pageLayout === "one-per-page" ? "80mm" : payload?.pageLayout === "two-per-page" ? "35mm" : payload?.pageLayout === "three-per-page" ? "16mm" : "0"}}.answer-unit{margin-top:8px}</style></head><body class="layout-${payload?.pageLayout || "compact"}">${content}</body></html>`
    return { preview: true, format: "pdf", count: all.length, previewCount: chosen.length, truncated: all.length > chosen.length, html }
  }
  if (command === "exportMistakes") {
    const exportIds = (payload?.recordIds || []).map(String)
    const chosen = records.filter(item => exportIds.includes(item.recordId))
    if (!chosen.length) throw new Error("当前导出范围没有可用错题")
    const extension = payload?.format === "md" ? "md" : "pdf"
    const filename = `${String(payload?.filename || "MN4错题导出").replace(/\.(md|pdf)$/i, "")}.${extension}`
    const link = document.createElement("a")
    if (extension === "pdf") return { printPanel: true, printCompleted: true, format: "pdf", filename, count: chosen.length }
    else {
      const markdown = [`# MN4 错题导出`, "", ...chosen.flatMap((item, index) => [`## ${index + 1}. ${item.sourceTitle}`, "", `**错题${item.level}级** · ${item.categoryLabel}`, "", `来源：${item.sourceNotebookTitle} › ${item.sourcePathTitles.join(" › ")}`, "", "### 原题卡片", "", questionHtml, "", "### 实时匹配答案", "", answerHtml, "", "---", ""])]
      link.href = URL.createObjectURL(new Blob([markdown.join("\n")], { type: "text/markdown;charset=utf-8" }))
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    }
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    return { saved: true, format: extension, filename, count: chosen.length }
  }
  if (command === "harnessCall") {
    if (!debugAiAnalysisEnabled) throw new Error("请先在调试功能中启用 AI 分析")
    return previewHarnessCall(payload?.command || "", payload?.data || {})
  }
  return { preview: true }
}

// —— P4-3 预览专用：Harness 命令面的内存模拟（仅本地预览页，设备路径不经过此文件） ——
const harnessPreview = { sessions: [], runs: {}, evidence: {}, synced: false, seq: 0, providers: [], credentialRefs: new Set(), roles: {}, authorizedRoles: { assistant: new Set(), reviewer: new Set() }, connectionTests: {}, requests: [], rates: {} }

/**
 * v2.14 §22：预览用请求明细（形状与真机 harness.getContextInsights 一致）。
 * 仅本地预览页使用；设备路径不经过此文件。
 */
function previewLocalDay(date) {
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function previewCostBuckets(rows) {
  const buckets = new Map()
  for (const row of rows) {
    if (row.outcome === "not_sent") continue
    const currency = row.rate?.currency ?? null
    const key = currency ?? "__unpriced"
    const bucket = buckets.get(key) ?? { currency, amount: null, requests: 0, pricedRequests: 0, unpricedRequests: 0, missingUsageRequests: 0 }
    bucket.requests += 1
    if (row.cost) {
      bucket.pricedRequests += 1
      bucket.amount = Math.round(((bucket.amount ?? 0) + row.cost.amount) * 1e6) / 1e6
    } else if (row.tokens.missing) {
      bucket.missingUsageRequests += 1
    } else {
      bucket.unpricedRequests += 1
    }
    buckets.set(key, bucket)
  }
  return [...buckets.values()].sort((a, b) => {
    if ((a.amount === null) !== (b.amount === null)) return a.amount === null ? 1 : -1
    if (a.amount !== null && b.amount !== null && a.amount !== b.amount) return b.amount - a.amount
    return String(a.currency ?? "") < String(b.currency ?? "") ? -1 : 1
  })
}

function previewInsights(sessionId, payload) {
  const limit = Math.max(1, Math.min(50, Number(payload?.limit ?? 8) || 8))
  const offset = Math.max(0, Math.min(500, Number(payload?.offset ?? 0) || 0))
  const days = Math.max(1, Math.min(30, Number(payload?.days ?? 7) || 7))
  const all = harnessPreview.requests
    .filter((item) => item.sessionId === sessionId)
    .sort((a, b) => (a.createdAt === b.createdAt ? b.requestSeq - a.requestSeq : a.createdAt < b.createdAt ? 1 : -1))
  const page = []
  for (let index = offset; index < Math.min(all.length, offset + limit); index++) {
    const row = all[index]
    const older = all[index + 1]
    page.push({ ...row, deltaInputTokens: older ? row.breakdown.totalTokens - older.breakdown.totalTokens : null })
  }
  const totals = {
    requests: all.length, delivered: 0, failed: 0, cancelled: 0, notSent: 0, unconfirmed: 0,
    promptTokens: 0, completionTokens: 0, promptMissing: 0, completionMissing: 0,
    promptEstimated: 0, completionEstimated: 0,
    breakdown: { instructionTokens: 0, compactionTokens: 0, toolDefinitionTokens: 0, messageTokens: 0, toolResultTokens: 0, overheadTokens: 0, totalTokens: 0 },
  }
  for (const row of all) {
    if (row.outcome === "delivered") totals.delivered += 1
    else if (row.outcome === "failed") totals.failed += 1
    else if (row.outcome === "cancelled") totals.cancelled += 1
    else if (row.outcome === "not_sent") totals.notSent += 1
    else totals.unconfirmed += 1
    if (row.tokens.prompt === undefined) totals.promptMissing += 1
    else totals.promptTokens += row.tokens.prompt
    if (row.tokens.completion === undefined) totals.completionMissing += 1
    else totals.completionTokens += row.tokens.completion
    if (row.tokens.promptSource === "estimated") totals.promptEstimated += 1
    if (row.tokens.completionSource === "estimated") totals.completionEstimated += 1
    if (row.outcome === "not_sent") continue
    for (const key of Object.keys(totals.breakdown)) totals.breakdown[key] += row.breakdown[key]
  }
  const now = new Date()
  const dayKeys = []
  for (let index = days - 1; index >= 0; index--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - index)
    dayKeys.push(previewLocalDay(date))
  }
  const dayRows = all.filter((row) => dayKeys.includes(previewLocalDay(new Date(row.createdAt))))
  const todayKey = previewLocalDay(now)
  return {
    sessionId,
    generatedAt: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    windowDays: days,
    limit,
    offset,
    requestCount: all.length,
    hasMore: offset + page.length < all.length,
    totals,
    requests: page,
    cost: {
      scope: "assistant_requests",
      session: previewCostBuckets(all),
      today: previewCostBuckets(dayRows.filter((row) => previewLocalDay(new Date(row.createdAt)) === todayKey)),
      days: dayKeys.map((date) => ({
        date,
        buckets: previewCostBuckets(dayRows.filter((row) => previewLocalDay(new Date(row.createdAt)) === date)),
      })),
      truncated: false,
    },
  }
}

/** 预览用模型目录（按预置的 Base URL 区分，便于验证"选择服务商 → 拉列表"流程）。 */
const PREVIEW_MODEL_CATALOG = {
  "https://api.deepseek.com": ["deepseek-chat", "deepseek-reasoner"],
  "https://api.openai.com/v1": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini"],
  "https://dashscope.aliyuncs.com/compatible-mode/v1": ["qwen-plus", "qwen-max", "qwen-turbo", "qwen-long"],
  "https://open.bigmodel.cn/api/paas/v4": ["glm-4-plus", "glm-4-air", "glm-4-flash"],
  "https://api.moonshot.cn/v1": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  "https://api.siliconflow.cn/v1": ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct", "THUDM/glm-4-9b-chat"],
  "https://openrouter.ai/api/v1": ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-001"],
  fallback: ["example-chat", "example-reasoner"],
}
function previewVerification(setting) {
  return harnessPreview.connectionTests[setting?.providerId]?.[setting?.model] ?? null
}

function previewSession(data, selected = false) {
  const root = harnessPreview.sessions.find((item) => item.id === data.sessionId && !item.rootId)
  if (!root || root.deletedAt) return null
  const branchId = data.branchId || (selected ? root.selectedBranchId : undefined) || root.id
  return branchId === root.id ? root : harnessPreview.sessions.find((item) => item.id === branchId && item.rootId === root.id) || null
}

function previewBranchView(root) {
  return { sessionId: root.id, branchId: root.selectedBranchId || root.id,
    branches: [{ id: root.id }, ...harnessPreview.sessions.filter((item) => item.rootId === root.id)
      .map((item) => ({ id: item.id, parentId: item.parentId, anchorId: item.anchorId, operation: item.operation }))] }
}

function previewHarnessCall(command, data) {
  switch (command) {
    case "harness.health":
      return { ok: true, data: { ok: true, snapshotId: harnessPreview.synced ? "preview-snap-0001" : "none", version: "h1-preview", credentialRefs: [...harnessPreview.credentialRefs], assistantConfigured: harnessPreview.credentialRefs.has(harnessPreview.roles.assistant?.credentialRef) } }
    case "harness.clearCredential":
      harnessPreview.credentialRefs.delete(data.credentialRef)
      delete harnessPreview.connectionTests[data.credentialRef]
      return { ok: true, data: { credentialRef: data.credentialRef, cleared: true } }
    case "harness.syncSnapshot": {
      harnessPreview.synced = true
      return { ok: true, data: { snapshotId: "preview-snap-0001", recordCount: records.length, inserted: records.length, updated: 0, unchanged: 0, carried: 0, repaired: 0, markedMissing: 0, warnings: [], sourceKind: "harness-contract", freshness: { status: "current", snapshotId: "preview-snap-0001", dataAsOf: new Date().toISOString() } } }
    }
    case "harness.getDataFreshness":
      // 预览模式没有真实本地错题源：同步前 unknown，同步后按模拟快照报告 current。
      return {
        ok: true,
        data: harnessPreview.synced
          ? { status: "current", snapshotId: "preview-snap-0001", baselineSnapshotId: "preview-snap-0001", dataAsOf: new Date().toISOString(), checkedAt: new Date().toISOString(), answerChanges: "not_tracked", answerChangesNote: "答案卡片正文的修改没有轻量本地信号；如需最新答案文本，请同步快照。" }
          : { status: "unknown", reason: "no_baseline: 预览模式尚未同步", snapshotId: "none", checkedAt: new Date().toISOString(), answerChanges: "not_tracked" },
      }
    case "harness.setBudgetTier": {
      const session = previewSession(data)
      if (!session) return { ok: false, error: { code: "not_found", message: "会话不存在" } }
      if (data.tier !== "simple" && data.tier !== "comparison" && data.tier !== "deep") {
        return { ok: false, error: { code: "invalid_args", message: "budgetTier 必须是 simple/comparison/deep" } }
      }
      session.budgetTier = data.tier
      return { ok: true, data: { sessionId: session.id, budgetTier: session.budgetTier } }
    }
    case "harness.stats":
      return { ok: true, data: { totalRecords: records.length, totalMistakes: records.length, availableRecords: records.length, levelCounts: { "0": records.filter(r => r.level === 0).length, "1": records.filter(r => r.level === 1).length, "2": records.filter(r => r.level === 2).length, unknown: 0 }, dueCount: 3, reviewedRecordCount: 2, totalReviewActions: 12, currentLevelReviewCountSum: 9, snapshotId: harnessPreview.synced ? "preview-snap-0001" : "none", dataAsOf: new Date().toISOString(), params: { statsTime: new Date().toISOString(), timezone: "Asia/Shanghai", dueBoundary: new Date().toISOString() } } }
    case "harness.createSession": {
      const session = { id: `preview-s-${++harnessPreview.seq}`, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), scope: { notebookIds: [] }, snapshotId: harnessPreview.synced ? "preview-snap-0001" : "none", status: "active", reviewLevel: "provenance", budgetTier: "simple" }
      if (harnessPreview.roles.assistant) session.assistantModel = { ...harnessPreview.roles.assistant }
      harnessPreview.sessions.unshift(session)
      return { ok: true, data: { sessionId: session.id } }
    }
    case "harness.listSessions": {
      // v2.4 §13.1：摘要列表（不返回消息体），与真机形状一致。
      const q = String(data?.query ?? "").trim()
      const items = harnessPreview.sessions
        .filter((s) => !s.deletedAt && !s.rootId)
        .filter((s) => !q || (s.title || "").includes(q) || (s.messages.find((m) => m.type === "user")?.text || "").includes(q))
        .map((s) => ({
          id: s.id,
          title: s.title,
          lastPreview: (s.messages.find((m) => m.type === "user")?.text || "").slice(0, 80) || undefined,
          messageCount: s.messages.length,
          status: s.status,
          reviewLevel: s.reviewLevel,
          budgetTier: s.budgetTier,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
        }))
      return { ok: true, data: items }
    }
    case "harness.renameSession": {
      const session = harnessPreview.sessions.find((s) => s.id === data.sessionId)
      if (!session) return { ok: false, error: { code: "not_found", message: "会话不存在" } }
      const title = String(data.title ?? "").trim()
      if (!title || title.length > 128) return { ok: false, error: { code: "invalid_args", message: "标题需为 1..128 字符" } }
      session.title = title
      session.updatedAt = new Date().toISOString()
      return { ok: true, data: { sessionId: session.id, title } }
    }
    case "harness.deleteSession": {
      const index = harnessPreview.sessions.findIndex((s) => s.id === data.sessionId)
      if (index < 0) return { ok: false, error: { code: "not_found", message: "会话不存在" } }
      harnessPreview.sessions = harnessPreview.sessions.filter((item) => item.id !== data.sessionId && item.rootId !== data.sessionId)
      return { ok: true, data: { sessionId: data.sessionId, deleted: true, cancelRequested: false } }
    }
    case "harness.purgeSession": {
      const index = harnessPreview.sessions.findIndex((s) => s.id === data.sessionId)
      if (index < 0) return { ok: false, error: { code: "not_found", message: "会话不存在" } }
      harnessPreview.sessions = harnessPreview.sessions.filter((item) => item.id !== data.sessionId && item.rootId !== data.sessionId)
      return { ok: true, data: { sessionId: data.sessionId, purged: true, cancelRequested: false } }
    }
    case "harness.exportSession": {
      // v2.4 §13.1：用户可读 Markdown（预览版：剔除 card:/stat: 协议，保留标题文本）。
      const session = previewSession(data)
      if (!session) return { ok: false, error: { code: "not_found", message: "会话不存在" } }
      const title = session.title || "未命名会话"
      const lines = ["# CardLink AI 分析会话", "", `- 会话：${title}`, "", "---", ""]
      for (const message of session.messages) {
        if (message.type === "user") lines.push("## 用户", "", message.text, "")
        else if (message.type === "assistant") {
          lines.push("## AI 分析", "", String(message.text || "").replace(/\[([^\]]+)\]\((?:card|stat):[^)]+\)/g, "$1"), "")
        }
      }
      return { ok: true, data: { title, filename: "cardlink-会话.md", markdown: lines.join("\n") } }
    }
    case "harness.resolveRecordTitles": {
      // v2.4 §10.1.1：重开会话时把持久化 recordId 解析为真实标题（预览用固定数据）。
      const ids = Array.isArray(data?.recordIds) ? data.recordIds : []
      const titles = {}
      for (const id of ids) {
        const record = records.find((r) => r.recordId === id)
        titles[id] = record
          ? { available: record.noteAvailable !== false, title: record.sourceTitle, notebookTitle: record.sourceNotebookTitle, level: record.level ?? null }
          : { available: false }
      }
      return { ok: true, data: titles }
    }
    case "plugin.previewRecord": {
      const record = records.find((item) => item.recordId === data.recordId)
      if (!record) return { ok: false, error: { code: "not_found", message: "原题不可访问" } }
      return { ok: true, data: { questionHtml: detail(record.recordId).questionHtml, title: record.sourceTitle } }
    }
    case "plugin.locateRecord":
      return { ok: false, error: { code: "locate_failed", message: "预览模式无法打开 MarginNote 原始卡片" } }
    case "harness.getSession": {
      const root = previewSession({ sessionId: data.sessionId })
      const session = previewSession(data, true)
      if (!root || !session) return { ok: false, error: { code: "not_found", message: "会话不存在" } }
      const callIds = new Set(session.messages.filter((message) => message.type === "tool_result").map((message) => message.toolCallId))
      const toolActivity = Object.fromEntries(Object.values(harnessPreview.runs)
        .flatMap((run) => (run.toolCalls ?? []).filter((call) => callIds.has(call.toolCallId)).map((call) => [call.toolCallId, call])))
      const pendingQuestion = Object.values(harnessPreview.runs).find((run) => run.sessionId === session.id && run.pendingQuestion)?.pendingQuestion
      return { ok: true, data: { ...session, ...previewBranchView(root), branchId: session.id,
        assistantModel: session.assistantModel ?? harnessPreview.roles.assistant, toolActivity, pendingQuestion } }
    }
    case "harness.selectSessionBranch": {
      const root = previewSession({ sessionId: data.sessionId })
      const branch = previewSession(data)
      if (!root || !branch) return { ok: false, error: { message: "分支不属于此会话" } }
      root.selectedBranchId = branch.id
      return { ok: true, data: previewBranchView(root) }
    }
    case "harness.forkSession": {
      const root = previewSession({ sessionId: data.sessionId })
      const from = previewSession(data, true)
      const index = from?.messages.findIndex((message) => message.type === "user" && message.id === data.anchorId)
      if (!root || !from || index < 0) return { ok: false, error: { message: "该问题不在当前分支" } }
      const regenerate = data.operation === "regenerate"
      const id = `preview-branch-${++harnessPreview.seq}`
      harnessPreview.sessions.push({ ...from, id, rootId: root.id, parentId: from.id, anchorId: data.anchorId,
        operation: data.operation, messages: from.messages.slice(0, index + (regenerate ? 1 : 0)) })
      root.selectedBranchId = id
      const result = previewHarnessCall(regenerate ? "harness.continueRun" : "harness.startRun",
        { ...data, branchId: id })
      return result.ok ? { ok: true, data: { ...previewBranchView(root), ...result.data } } : result
    }
    case "harness.saveQuestionDraft": {
      const pending = harnessPreview.runs[data.runId]?.pendingQuestion
      if (!pending || data.questionId !== pending.questionId) return { ok: false, error: { message: "问题已结束" } }
      pending.draft = data.answers
      return { ok: true, data: { saved: true } }
    }
    case "harness.answerRunQuestion": {
      const run = harnessPreview.runs[data.runId]
      if (!run?.pendingQuestion || run.pendingQuestion.questionId !== data.questionId || !data.answers?.scope?.length) {
        return { ok: false, error: { message: "请选择当前问题的选项" } }
      }
      const session = previewSession(data)
      if (session?.id !== run.sessionId) return { ok: false, error: { message: "问题不属于此分支" } }
      session.messages.push({ type: "user", id: data.runId + "-choice", text: "已选择：" + data.answers.scope.join("、"), createdAt: new Date().toISOString() })
      run.pendingQuestion = null
      run.answered = true
      return { ok: true, data: { runId: data.runId } }
    }
    case "harness.cancelRun": {
      const run = harnessPreview.runs[data.runId]
      if (run) { run.cancelled = true; run.pendingQuestion = null }
      return { ok: true, data: { runId: data.runId, cancelRequested: true } }
    }
    case "harness.setSessionModel": {
      const session = previewSession(data)
      const provider = harnessPreview.providers.find((item) => item.id === data.providerId)
      if (!session || !provider || !harnessPreview.authorizedRoles.assistant.has(provider.id) ||
        !harnessPreview.credentialRefs.has(provider.credentialRef) || !data.model?.trim()) {
        return { ok: false, error: { message: "请先在 AI 分析设置中授权该助手连接" } }
      }
      session.assistantModel = { providerId: provider.id, credentialRef: provider.credentialRef, model: data.model.trim() }
      return { ok: true, data: session.assistantModel }
    }
    case "harness.startRun": {
      const session = previewSession(data)
      if (!session) return { ok: false, error: { code: "session_not_found", message: "会话不存在" } }
      const runId = `preview-run-${++harnessPreview.seq}`
      session.messages.push({ type: "user", id: runId + "-user", text: data.text, createdAt: new Date().toISOString() })
      const started = Date.now()
      harnessPreview.runs[runId] = {
        sessionId: session.id, question: data.text, started, budgetTier: data.budgetTier ?? session.budgetTier ?? "simple",
        phase: () => (Date.now() - started < 700 ? { status: "active", phase: "assistant_pending", iteration: 0 } : Date.now() - started < 1400 ? { status: "active", phase: "tool_pending", iteration: 0 } : { status: "finished", phase: "finished", iteration: 1 }),
      }
      return { ok: true, data: { runId } }
    }
    case "harness.continueRun": {
      // v2.4 §11.1：续答（不追加用户消息；预览用同一套阶段模拟）。
      const session = previewSession(data)
      if (!session) return { ok: false, error: { code: "session_not_found", message: "会话不存在" } }
      const runId = `preview-run-${++harnessPreview.seq}`
      const started = Date.now()
      harnessPreview.runs[runId] = {
        sessionId: session.id, question: "(continue)", started, budgetTier: data.budgetTier ?? session.budgetTier ?? "simple",
        phase: () => (Date.now() - started < 700 ? { status: "active", phase: "assistant_pending", iteration: 0 } : Date.now() - started < 1400 ? { status: "active", phase: "final_pending", iteration: 1 } : { status: "finished", phase: "finished", iteration: 1 }),
      }
      return { ok: true, data: { runId } }
    }
    case "harness.getRunStatus": {
      const run = harnessPreview.runs[data.runId]
      if (!run) return { ok: true, data: { runId: data.runId, status: "not_found" } }
      if (run.cancelled) return { ok: true, data: { runId: data.runId, status: "cancelled" } }
      const state = run.phase()
      if (state.status === "finished" && /先问我/.test(run.question) && !run.answered) {
        run.pendingQuestion ||= { runId: data.runId, questionId: data.runId + "-question",
          steps: [{ id: "scope", question: "要分析哪类错题？", selectionMode: "single", minSelections: 1, maxSelections: 1,
            options: [{ id: "due", label: "待复习" }, { id: "all", label: "所有错题" }] }] }
        return { ok: true, data: { runId: data.runId, status: "waiting_input", pendingQuestion: run.pendingQuestion } }
      }
      if (state.status === "finished" && !run.result) {
        const session = harnessPreview.sessions.find(s => s.id === run.sessionId)
        const evidenceId = `ev_preview_${++harnessPreview.seq}`
        const toolCallId = data.runId + "-stats"
        harnessPreview.evidence[evidenceId] = { evidenceId, runId: data.runId, snapshotId: "preview-snap-0001", sourceType: "tool_result", sourceRef: toolCallId, resultHash: "previewhash0000000000000000000000000000000000000000000000000000000000", generatedAt: new Date().toISOString() }
        run.result = { status: "completed", finishReason: "completed", budget: { tier: run.budgetTier, maxIterations: run.budgetTier === "deep" ? 12 : run.budgetTier === "comparison" ? 8 : 4, maxToolCalls: run.budgetTier === "deep" ? 24 : run.budgetTier === "comparison" ? 16 : 8, maxDurationMs: 300000, usedToolCalls: 1 }, message: `预览模式回答：当前错题库共 ${records.length} 条，其中 3 条应复习（Harness 口径）。等级分布：不会 ${records.filter(r => r.level === 0).length} 条、不熟 ${records.filter(r => r.level === 1).length} 条、掌握 ${records.filter(r => r.level === 2).length} 条。建议优先复习 [《${records[0]?.sourceTitle ?? "错题"}》](card:${records[0]?.recordId ?? "questions:q1"})。`, evidenceRefs: ["questions:q1"], warnings: [], usage: { promptTokens: 1250, completionTokens: 320, totalTokens: 1570, estimated: true }, context: { inputBudgetTokens: 24576, estimatedInputTokens: 1250, compactionTriggerTokens: 20889, compactionStatus: "reused", outputBudgetTokens: 16384, reservedTokens: 4096, compactionCount: 1 } }
        const statsEnvelope = { ok: true, tool: "getMistakeStats", data: { totalRecords: records.length, totalMistakes: records.length, availableRecords: records.length, levelCounts: { "0": 1, "1": 2, "2": 2, unknown: 0 }, dueCount: 3, reviewedRecordCount: 2, totalReviewActions: 12, currentLevelReviewCountSum: 4, snapshotId: "preview-snap-0001", dataAsOf: new Date().toISOString(), params: { statsTime: new Date().toISOString(), timezone: "Asia/Shanghai", dueBoundary: new Date().toISOString() } }, evidence: { snapshotId: "preview-snap-0001" } }
        run.toolCalls = [{ toolCallId, runId: data.runId, toolName: "getMistakeStats", executionStatus: "executed", resultJson: JSON.stringify(statsEnvelope), evidenceJson: JSON.stringify({ evidenceId, snapshotId: "preview-snap-0001" }), reviewerApproved: true, reviewerReason: "ok" }]
        if (session) {
          session.messages.push({ type: "tool_result", toolCallId, content: { tool: "getMistakeStats", data: { totalRecords: records.length, totalMistakes: records.length, availableRecords: records.length, levelCounts: { "0": 1, "1": 2, "2": 2, unknown: 0 }, dueCount: 3, reviewedRecordCount: 2, currentLevelReviewCountSum: 4, snapshotId: "preview-snap-0001", dataAsOf: new Date().toISOString(), params: { statsTime: new Date().toISOString(), timezone: "Asia/Shanghai", dueBoundary: new Date().toISOString() } }, evidence: { snapshotId: "preview-snap-0001" } }, createdAt: new Date().toISOString() })
        }
        if (session) session.messages.push({ type: "assistant", id: data.runId + "-assistant", text: run.result.message, evidenceRefs: ["questions:q1"], createdAt: new Date().toISOString() })
        // v2.14 §22：每次预览运行追加一条请求明细（与真机字段一致）。
        const usage = run.result.usage
        const rate = harnessPreview.rates[`cardlink-device::deepseek-chat`] ?? null
        const breakdown = { instructionTokens: 780, compactionTokens: 0, toolDefinitionTokens: 120, messageTokens: 322, toolResultTokens: 20, overheadTokens: 8, totalTokens: 1250 }
        harnessPreview.requests.push({
          sessionId: run.sessionId,
          runId: data.runId,
          requestSeq: harnessPreview.requests.filter((item) => item.sessionId === run.sessionId).length + 1,
          attempt: 1,
          providerId: "cardlink-device",
          model: "deepseek-chat",
          createdAt: new Date().toISOString(),
          outcome: "delivered",
          finishReason: "completed",
          breakdown,
          budget: { inputBudgetTokens: 24576, outputBudgetTokens: 16384, reservedTokens: 4096, compactionTriggerTokens: 20889 },
          compaction: { id: "preview-cmp-1", applied: false, triggerReason: "budget" },
          tokens: {
            prompt: usage.promptTokens, completion: usage.completionTokens, total: usage.totalTokens,
            promptSource: "estimated", completionSource: "estimated", estimated: true, missing: false,
          },
          cost: rate
            ? { currency: rate.currency, amount: Math.round(((usage.promptTokens / 1e6) * rate.inputPerMillion + (usage.completionTokens / 1e6) * rate.outputPerMillion) * 1e6) / 1e6 }
            : null,
          rate,
        })
      }
      return { ok: true, data: { runId: data.runId, ...state, budgetTier: run.budgetTier, budget: run.result?.budget, result: run.result, usage: run.result?.usage, context: run.result?.context, compactionCount: run.result?.context?.compactionCount ?? 0, toolCalls: run.toolCalls ?? [] } }
    }
    case "harness.getEvidence": {
      const row = harnessPreview.evidence[data.evidenceId]
      if (!row) return { ok: false, error: { code: "not_found", message: "证据不存在" } }
      const run = harnessPreview.runs[row.runId]
      const call = run?.toolCalls?.find((c) => c.toolCallId === row.sourceRef) ?? null
      return { ok: true, data: { ...row, toolName: call?.toolName ?? "getMistakeStats", envelope: call?.resultJson ? JSON.parse(call.resultJson) : null } }
    }
    case "harness.listModelProviders":
      return { ok: true, data: harnessPreview.providers.map((p) => ({ ...p })) }
    case "harness.getModelSettings":
      return { ok: true, data: {
        connections: harnessPreview.providers.map((item) => ({
          ...item, keySet: harnessPreview.credentialRefs.has(item.credentialRef),
          authorizedRoles: ["assistant", "reviewer"].filter((role) => harnessPreview.authorizedRoles[role].has(item.id)),
        })),
        assistant: harnessPreview.roles.assistant ?? null,
        reviewer: harnessPreview.roles.reviewer ?? null,
        assistantVerification: previewVerification(harnessPreview.roles.assistant),
        reviewerVerification: previewVerification(harnessPreview.roles.reviewer),
      } }
    case "harness.saveModelConnection": {
      const baseUrl = String(data.baseUrl || "").trim().replace(/\/+$/, "")
      const previous = harnessPreview.providers.find((item) => item.id === data.connectionId)
      if (!/^https:\/\/[^/?#@\s\\]+(?:\/[^?#\s\\]*)?$/.test(baseUrl) || !data.apiKey?.trim()) {
        return { ok: false, error: { message: "请填写有效的 HTTPS 接口地址及 API Key" } }
      }
      const id = previous?.baseUrl === baseUrl ? previous.id : `preview-connection-${++harnessPreview.seq}`
      const connection = previous?.id === id ? previous : { id, baseUrl, protocol: "openai-compatible", credentialRef: id, enabled: true }
      harnessPreview.credentialRefs.add(connection.credentialRef)
      delete harnessPreview.connectionTests[connection.id]
      harnessPreview.providers = [...harnessPreview.providers.filter((item) => item.id !== id), connection]
      return { ok: true, data: { connection: { ...connection, keySet: true } } }
    }
    case "harness.activateModelRoles": {
      const read = (role, input) => {
        const provider = harnessPreview.providers.find((item) => item.id === input.providerId && item.enabled)
        if (!provider || !input.model?.trim() || !harnessPreview.credentialRefs.has(provider.credentialRef) ||
          (harnessPreview.roles[role]?.providerId !== provider.id && !harnessPreview.authorizedRoles[role].has(provider.id) && input.authorized !== true)) return null
        return { providerId: provider.id, model: input.model.trim(), credentialRef: provider.credentialRef, maxOutputTokens: role === "reviewer" ? 1024 : input.maxOutputTokens }
      }
      const assistant = read("assistant", data.assistant)
      const followsAssistant = data.reviewer.followsAssistant === true
      const reviewer = read("reviewer", followsAssistant ? { ...data.assistant, authorized: data.reviewer.authorized } : data.reviewer)
      if (!assistant || !reviewer) return { ok: false, error: { message: "请填写有密钥的连接及模型，并授权两个角色" } }
      harnessPreview.roles = { assistant, reviewer: { ...reviewer, followsAssistant } }
      harnessPreview.authorizedRoles.assistant.add(assistant.providerId)
      harnessPreview.authorizedRoles.reviewer.add(reviewer.providerId)
      return { ok: true, data: { ...harnessPreview.roles, assistantVerification: previewVerification(assistant), reviewerVerification: previewVerification(reviewer) } }
    }
    case "harness.listProviderModels": {
      // v2.3 §5.1.6：预览用固定目录，形状与真机一致（只含模型标识与时间）。
      const config = harnessPreview.providers.find((p) => p.id === data.providerId)
      if (!config) return { ok: false, error: { code: "provider_not_found", message: `provider_not_found: ${data.providerId}` } }
      if (config.enabled === false) return { ok: false, error: { code: "provider_disabled", message: `provider_disabled: ${data.providerId}` } }
      if (!harnessPreview.credentialRefs.has(config.credentialRef)) return { ok: false, error: { code: "credential_missing", message: "credential_missing" } }
      const catalog = PREVIEW_MODEL_CATALOG[String(config.baseUrl || "")] || PREVIEW_MODEL_CATALOG.fallback
      return {
        ok: true,
        data: {
          providerId: config.id,
          models: catalog.map((id) => ({ id })),
          fetchedAt: new Date().toISOString(),
          source: "network",
        },
      }
    }
    case "harness.setProviderConfig":
      harnessPreview.providers = [
        ...harnessPreview.providers.filter((p) => p.id !== data.config?.id),
        { ...(data.config || {}), enabled: data.config?.enabled !== false },
      ]
      return { ok: true, data: { id: data.config?.id ?? "cardlink-device" } }
    case "harness.setCredential":
      harnessPreview.credentialRefs.add(data.credentialRef)
      return { ok: true, data: { credentialRef: data.credentialRef, set: true } }
    case "harness.setModelRoleConfig":
      harnessPreview.roles[data.role] = { providerId: data.providerId, model: data.model, credentialRef: data.credentialRef, timeoutMs: data.timeoutMs, maxOutputTokens: data.maxOutputTokens }
      return { ok: true, data: { role: data.role, setting: harnessPreview.roles[data.role] } }
    case "harness.getModelCapabilities": {
      // v2.5 §5.2：预览用能力表与真机一致（精确模型 id 命中，未知名走保守默认）。
      const presets = { "deepseek-chat": [65536, 8192], "deepseek-reasoner": [65536, 8192], "gpt-4o": [128000, 16384], "qwen-plus": [131072, 8192] }
      const preset = presets[String(data.model || "").toLowerCase()]
      const override = harnessPreview.capabilities?.[`${data.providerId}::${data.model}`]
      const capabilities = override ?? {
        providerId: data.providerId, modelId: data.model,
        contextWindowTokens: preset?.[0] ?? 32768, maxOutputTokens: preset?.[1] ?? 8192,
        supportsToolCalls: true, supportsUsage: Boolean(preset), tokenEstimatorId: "heuristic-v1",
        source: preset ? "verified" : "default",
      }
      return { ok: true, data: { capabilities, calibrationRatio: harnessPreview.calibration ?? undefined } }
    }
    case "harness.setModelCapabilities": {
      const caps = {
        providerId: data.providerId, modelId: data.modelId ?? data.model,
        contextWindowTokens: Number(data.contextWindowTokens), maxOutputTokens: Number(data.maxOutputTokens),
        supportsToolCalls: data.supportsToolCalls !== false, supportsUsage: data.supportsUsage === true,
        tokenEstimatorId: "heuristic-v1", source: "user",
      }
      if (!Number.isFinite(caps.contextWindowTokens) || caps.contextWindowTokens < 1024 || !Number.isFinite(caps.maxOutputTokens) || caps.maxOutputTokens < 1 || caps.maxOutputTokens > caps.contextWindowTokens) {
        return { ok: false, error: { code: "invalid_args", message: "上下文窗口或输出上限非法" } }
      }
      harnessPreview.capabilities = { ...(harnessPreview.capabilities || {}), [`${caps.providerId}::${caps.modelId}`]: caps }
      return { ok: true, data: caps }
    }
    case "harness.getContextInsights": {
      // v2.14 §22：只读请求明细 + 费用估算（预览用内存数据）。
      const sessionId = String(data?.sessionId ?? "")
      if (!sessionId.trim()) return { ok: false, error: { code: "invalid_args", message: "sessionId 非法" } }
      if (!harnessPreview.sessions.some((s) => s.id === sessionId)) {
        return { ok: false, error: { code: "not_found", message: `会话不存在: ${sessionId}` } }
      }
      return { ok: true, data: previewInsights(sessionId, data) }
    }
    case "harness.getModelRate": {
      const key = `${data?.providerId}::${data?.model}`.toLowerCase()
      const found = harnessPreview.rates[key] ?? harnessPreview.rates[`${data?.providerId}::${data?.model}`] ?? null
      return { ok: true, data: { providerId: data?.providerId, model: data?.model, rate: found } }
    }
    case "harness.setModelRate": {
      const currency = String(data?.currency ?? "").trim().toUpperCase()
      const input = Number(data?.inputPerMillion)
      const output = Number(data?.outputPerMillion)
      if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
        return { ok: false, error: { code: "invalid_args", message: "币种或单价非法" } }
      }
      const rate = { providerId: String(data?.providerId ?? ""), model: String(data?.model ?? ""), currency, inputPerMillion: input, outputPerMillion: output, updatedAt: new Date().toISOString() }
      harnessPreview.rates[`${rate.providerId}::${rate.model}`] = rate
      // 新费率只影响之后记录的请求（历史快照不改写）。
      return { ok: true, data: rate }
    }
    case "harness.clearModelRate": {
      const key = `${data?.providerId}::${data?.model}`
      const existed = Boolean(harnessPreview.rates[key])
      delete harnessPreview.rates[key]
      return { ok: true, data: { providerId: data?.providerId, model: data?.model, cleared: existed } }
    }
    case "harness.listModelRates":
      return { ok: true, data: Object.values(harnessPreview.rates) }
    case "harness.setReviewLevel": {
      const session = previewSession(data)
      if (!session) return { ok: false, error: { code: "not_found", message: "会话不存在" } }
      if (!["strict", "provenance", "full_allow"].includes(data.level)) return { ok: false, error: { code: "invalid_args", message: "非法审核档位" } }
      session.reviewLevel = data.level
      return { ok: true, data: { sessionId: session.id, reviewLevel: session.reviewLevel } }
    }
    case "harness.testModelProvider": {
      const { providerId, model } = data
      harnessPreview.connectionTests[providerId] = { ...harnessPreview.connectionTests[providerId], [model]: true }
      return { ok: true, data: { providerId, model, reachable: true } }
    }
    default:
      return { ok: false, error: { code: "preview_unsupported", message: `预览模式不支持 ${command}（真机可用）` } }
  }
}
