import { escapeHtml } from "../../../src/html-utils"

const DAY = 86400000
const levelCurves = [[1, 3, 7], [2, 5, 10], [14]]
let customCategories = ["计算题", "概念辨析", "需要重做"]
let debugModeEnabled = false
let pluginEnabled = true

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

let previewPreparationJob = null
function previewPreparationPublic() {
  if (!previewPreparationJob) return { status: "missing" }
  return { ...previewPreparationJob, recordIds: undefined, totalProgress: previewPreparationJob.total ? Math.round(previewPreparationJob.completed / previewPreparationJob.total * 100) : 100 }
}
function previewPreparationCurrent() {
  const recordId = previewPreparationJob?.recordIds?.[previewPreparationJob.completed]
  const record = records.find(item => item.recordId === recordId)
  return record ? { recordId, title: record.sourceTitle, index: previewPreparationJob.completed + 1, total: previewPreparationJob.total, stage: "waiting-render", progress: 0, detail: "等待渲染题目卡片", ocrText: "" } : undefined
}

export async function previewSend(command, payload = null) {
  if (command === "mistakesRevision") return { revision: workbench().revision || "preview" }
  // AI 配置页与总览 AI 面板的预览 mock：形状与原生 publicSettings/报告索引一致。
  if (command === "aiConfirmDevelopmentWarning") return { confirmed: true }
  if (command === "aiGetSettings") return {
    schemaVersion: 1, enabled: true, defaultProfileId: "openai-main",
    profiles: [
      { id: "openai-main", name: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5", timeoutMs: 60000, credentialRef: "llm-openai-main" },
      { id: "deepseek-main", name: "DeepSeek", type: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", timeoutMs: 60000, credentialRef: "llm-deepseek-main" }
    ],
    subjects: [{ id: "subject-math", name: "考研数学", studySetIds: ["set-1"], schedule: { enabled: true, frequency: "weekly", hour: 9, weekday: 1, monthday: 1, lastRunAt: "2026-09-05T09:00:00.000Z" } }],
    ocrEngine: "glm-ocr",
    mineru: { enabled: true, baseUrl: "https://mineru.net", credentialRef: "ocr-mineru", model: "vlm", language: "ch", enableFormula: true, enableTable: true, policy: "auto" },
    glmOcr: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", credentialRef: "ocr-glm", model: "glm-ocr", timeoutMs: 120000 },
    privacy: { includeAnswer: true, includeSourcePath: true, includeReviewHistory: true, includeCustomCategories: true, images: "when-needed", handwriting: false, mindMapHandwriting: true },
    credentials: {
      "llm-openai-main": { configured: true, persistence: "local", maskedSuffix: "8f2a" },
      "llm-deepseek-main": { configured: false, persistence: "none", maskedSuffix: "" },
      "ocr-mineru": { configured: false, persistence: "none", maskedSuffix: "" },
      "ocr-glm": { configured: true, persistence: "local", maskedSuffix: "c913" }
    }
  }
  if (command === "aiSaveSettings") return payload
  if (command === "aiListStudySets") return [{ id: "questions", title: "高等数学题集" }, { id: "practice", title: "强化练习" }, { id: "empty", title: "暂未标记错题的学习集" }]
  if (command === "aiListMistakeStudySets") return [{ id: "questions", title: "高等数学题集", mistakeCount: 2 }, { id: "practice", title: "强化练习", mistakeCount: 1 }]
  if (command === "aiGetCacheStats") return { ocrEntries: 23, preparedEntries: 18, reportCount: 2 }
  if (command === "aiListReports") return []
  if (command === "aiStartQuestionPreparation") {
    const recordIds = records.filter(item => item.sourceNotebookId === payload?.studySetId).map(item => item.recordId)
    previewPreparationJob = { id: `preview-prep-${Date.now()}`, studySetId: payload?.studySetId, status: recordIds.length ? "waiting-render" : "done", total: recordIds.length, completed: 0, success: 0, failed: 0, recordIds, current: undefined }
    previewPreparationJob.current = previewPreparationCurrent()
    return previewPreparationPublic()
  }
  if (command === "aiGetQuestionPreparationJob") return previewPreparationPublic()
  if (command === "aiGetPreparationQuestion") {
    if (!previewPreparationJob?.current) throw new Error("题目准备任务不存在")
    previewPreparationJob.current = { ...previewPreparationJob.current, stage: "rendering", detail: "正在渲染整张题目卡片" }
    return { recordId: payload?.recordId, title: previewPreparationJob.current.title, questionHtml: detail(String(payload?.recordId || "")).questionHtml }
  }
  if (command === "aiSubmitPreparationImage") {
    if (!previewPreparationJob?.current) throw new Error("题目准备任务不存在")
    previewPreparationJob.completed += 1
    previewPreparationJob.success += 1
    previewPreparationJob.current = { ...previewPreparationJob.current, stage: "success", progress: 100, detail: "识别并保存完成", ocrText: "设二元函数 f(x,y) 在点 (x₀,y₀) 处的两个偏导数存在，判断该函数在该点连续的充分性与必要性。" }
    previewPreparationJob.status = previewPreparationJob.completed >= previewPreparationJob.total ? "done" : "waiting-advance"
    return { accepted: true }
  }
  if (command === "aiFailPreparationQuestion") {
    previewPreparationJob.completed += 1
    previewPreparationJob.failed += 1
    previewPreparationJob.current = { ...previewPreparationJob.current, stage: "failed", detail: payload?.error || "渲染失败", error: payload?.error || "渲染失败" }
    previewPreparationJob.status = previewPreparationJob.completed >= previewPreparationJob.total ? "done" : "waiting-advance"
    return previewPreparationPublic()
  }
  if (command === "aiAdvanceQuestionPreparation") {
    previewPreparationJob.current = previewPreparationCurrent()
    previewPreparationJob.status = previewPreparationJob.current ? "waiting-render" : "done"
    return previewPreparationPublic()
  }
  if (command === "aiCancelQuestionPreparation") { if (previewPreparationJob) previewPreparationJob.status = "cancelled"; return { cancelled: !!previewPreparationJob } }
  if (command === "aiRunDueSchedules" || command === "aiGetJob" || command === "aiPreviewAnalysis") return { accepted: true, status: "missing" }
  if (command === "dashboard") return {
    version: "2.4.0 · 完整界面预览",
    mistakes: workbenchPage(),
    aiEnabled: true,
    matching: {
      scopedBinding: true,
      mode: "title",
      matchedGroups: 0,
      pairs: 0,
      regexRules: { questionPattern: "", answerPattern: "" },
      debugModeEnabled,
      pluginEnabled
    }
  }
  if (command === "mistakes") return workbenchPage()
  if (command === "mistakesPage") return workbenchPage(payload?.offset, String(payload?.transferId || "preview-workbench"))
  if (command === "testTelemetryConnectivity") {
    if (!debugModeEnabled) throw new Error("请先开启调试模式")
    return {
      test: true,
      testedAt: new Date().toISOString(),
      results: [
        { key: "测试1", reachable: true, accepted: true, statusCode: 204, durationMs: 12 },
        { key: "测试2", reachable: true, accepted: true, statusCode: 204, durationMs: 30 },
        { key: "测试3", reachable: false, error: "无响应", durationMs: 8000 }
      ]
    }
  }
  if (command === "setDebugMode") {
    debugModeEnabled = payload?.enabled === true
    return { enabled: debugModeEnabled }
  }
  if (command === "setPluginEnabled") {
    pluginEnabled = payload?.enabled === true
    return { enabled: pluginEnabled }
  }
  if (command === "mistakeDetail") return detail(String(payload?.recordId ?? ""))
  if (command === "mistakeQuestion") {
    const value = detail(String(payload?.recordId ?? ""))
    return { questionHtml: value.questionHtml }
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
    const chosen = records.filter(item => exportIds.includes(item.recordId))
    if (!chosen.length) throw new Error("当前预览范围没有可用错题")
    if (payload?.format === "md") {
      const markdown = [`# MN4 错题导出`, "", ...chosen.flatMap((item, index) => [`## ${index + 1}. ${item.sourceTitle}`, "", `来源：${item.sourceNotebookTitle} › ${item.sourcePathTitles.join(" › ")}`, "", "### 原题卡片", "", "题目卡片正文", "", "### 实时匹配答案", "", "答案卡片正文", "", "---", ""])]
      return { preview: true, format: "md", count: chosen.length, markdown: markdown.join("\n") }
    }
    const include = { question: true, answer: true, source: true, review: false, ...(payload?.include || {}) }
    const question = (item, index) => `<article class="mistake question-unit"><header><b>${index + 1}.</b><h1>${item.sourceTitle}</h1></header>${include.source ? `<small>来源：${item.sourceNotebookTitle} › ${item.sourcePathTitles.join(" › ")}</small>` : ""}${include.question ? `<div class="card">${questionHtml}</div>` : ""}<div class="writing-space"></div></article>`
    const answer = (item, index) => `<article class="mistake answer-unit"><header><b>答案 ${index + 1}</b><h1>${item.sourceTitle}</h1></header><div class="card">${answerHtml}</div></article>`
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
    return { preview: true, format: "pdf", count: chosen.length, html }
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
  return { preview: true }
}
