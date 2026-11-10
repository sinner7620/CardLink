/**
 * Web 面板渲染冒烟测试：各页签/关键组件逐个 renderToString。
 * 目标是抓住「设置页白屏」一类只在运行时炸掉的渲染崩溃
 * （如 REVIEW_CURVES 对象被当数组 .map 的事故）。
 * bundle 由 scripts/build-web-smoke.mjs 生成：CSS/DOM 侧效脚本置空，
 * react/react-dom external 以共享 Node 侧同一份 React。
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderOCRMarkdownPreview } from "../src/markdown"

// 项目未装 @types/react（面板源码为 jsx），测试侧用 any 化的运行时引用即可
const require = createRequire(import.meta.url)
const React: any = require("react")
const renderToString: (node: any) => string = require("react-dom/server").renderToString

// tsx 下 import.meta.dirname 不可用，从 url 推导项目根
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
execFileSync(process.execPath, [join(projectRoot, "scripts/build-web-smoke.mjs")], {
  cwd: projectRoot,
  stdio: "pipe"
})

// main.jsx 顶层的 mnBridge 等已被置空，但 bundle 内组件仍可能在
// 渲染路径上探测 window；给最小全局，避免环境噪音。
;(globalThis as Record<string, unknown>).window = globalThis
;(globalThis as Record<string, unknown>).location = { hostname: "smoke.test" }
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => {}
}

const ui = require(join(projectRoot, "output/web-smoke.cjs")) as Record<string, any>

const noop = () => {}
const asyncNoop = () => Promise.resolve({})

test("打开 OCR 数据库时渲染概览", () => {
  const html = renderToString(React.createElement(ui.OCRDatabase, {
    sourceRevision: 0,
    onBack: noop,
    onQueueActive: noop,
    onIndexed: noop,
    onPreferencesChanged: noop
  }))
  assert.match(html, /<h1>OCR 数据库<\/h1>/)
  assert.match(html, /数据库概览/)
})
const REVIEW_CURVES_ARRAY = [[1, 3, 7], [2, 5, 10], [14]]
// 面板侧历史上的白屏正是把对象形态的 REVIEW_CURVES 当数组用；两条形态都要能渲染。
const REVIEW_CURVES_OBJECT = { 0: [1, 3, 7], 1: [2, 5, 10], 2: [14] } as unknown as number[][]

test('复测时间轴显示保存的错因，自定义标签按文本转义，旧历史仍能渲染', () => {
  const html = renderToString(React.createElement(ui.ReviewTimeline, {
    history: [
      { at: '2026-10-31T00:00:00Z', level: 0, errorReason: { key: 'custom', label: '<img src=x>' } },
      { at: '2026-11-01T00:00:00Z', level: 2 }
    ], gapForIndex: () => 20
  }))
  assert.match(html, /错因：&lt;img src=x&gt;/)
  assert.match(html, /previewTimelineReason/)
  assert.doesNotMatch(html, /<img src=x>/)
})

test("OCR 结果 Markdown 含图片和链接时可安全渲染", () => {
  const html = renderOCRMarkdownPreview("![电路图](assets/q1.png) 与 [参考链接](https://example.com) <img src=x onerror=alert(1)>")
  assert.match(html, /\[图片：电路图\]/)
  assert.match(html, /参考链接/)
  assert.doesNotMatch(html, /<img\b|<a\b/)
})

test("OCR 题干的行内公式与独立公式渲染为 MathML", () => {
  const html = renderOCRMarkdownPreview("设 $A$ 为 3 阶矩阵，若 $|E-A|=|E+A|=1$。\n\n$$|3E-A|=2$$")
  assert.equal(html.match(/<math\b/g)?.length, 3)
  assert.match(html, /<math[^>]*display="block"/)
  assert.doesNotMatch(html, /\$A\$/)
})

function record(overrides: Record<string, unknown> = {}) {
  const now = new Date()
  return {
    recordId: "nb1:n1",
    sourceNotebookId: "nb1",
    sourceNoteId: "n1",
    sourceNotebookTitle: "题目学习集",
    sourceRootNodeId: undefined,
    sourceRootTitle: "主脑图",
    sourceTitle: "第 1 题",
    sourcePathTitles: ["第一章"],
    categoryPath: ["题目学习集", "第一章"],
    categoryLabel: "题目学习集 / 第一章",
    manualCategory: undefined,
    manualCategories: [],
    level: 0,
    levelModel: 3,
    reviewScheduleModel: 3,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    nextReviewAt: new Date(now.getTime() - 86400000).toISOString(),
    reviewCount: 0,
    history: [],
    reviewCompleted: false,
    noteAvailable: true,
    ...overrides
  }
}

function detailFor(item: Record<string, unknown>) {
  return {
    record: item,
    answers: [],
    questionHtml: "<p>题目内容</p>",
    answerStatus: "unbound"
  }
}

const actionStub = asyncNoop as unknown as (command: string, payload?: unknown, reload?: boolean) => Promise<any>

test("App 顶层壳在无数据时可渲染", () => {
  const html = renderToString(React.createElement(ui.App))
  assert.match(html, /错题本/)
  assert.match(html, /topNav/)
})

test("总览页签渲染统计卡片与来源分布", () => {
  const records = [
    record({ recordId: "a:1", sourceNoteId: "1", level: 0 }),
    record({ recordId: "a:2", sourceNoteId: "2", level: 1 }),
    record({ recordId: "a:3", sourceNoteId: "3", level: 2, reviewCompleted: true })
  ]
  const html = renderToString(React.createElement(ui.MistakeOverview, {
    records,
    onBrowse: noop,
    onOpen: noop,
    onSource: noop
  }))
  assert.match(html, /错题本学习进度/)
  assert.match(html, /错题来源分布/)
  assert.match(html, /第 1 题/)
})

test("错题本浏览页签渲染列表", () => {
  const records = [record(), record({ recordId: "b:2", sourceNoteId: "2", sourceTitle: "第 2 题", level: 1 })]
  const html = renderToString(React.createElement(ui.MistakeBrowser, {
    records,
    allRecords: records,
    selectedId: "",
    detail: null,
    openDetail: noop,
    action: actionStub,
    reloadDetail: asyncNoop,
    onRemoved: noop,
    onExportSelected: noop,
    query: "",
    setQuery: noop,
    categoryPath: [],
    setCategoryPath: noop,
    level: "all",
    setLevel: noop,
    customCategories: ["计算题"]
  }))
  assert.match(html, /第 1 题/)
  assert.match(html, /第 2 题/)
  const controls = [...html.matchAll(/aria-label="(进入多选|搜索错题|筛选|排序)"/g)].map(match => match[1])
  assert.deepEqual(controls, ["搜索错题", "筛选", "排序", "进入多选"])
  assert.doesNotMatch(html, /filterCollapseButton|filterSelectors|class="filterCount"|共\d+道/)
})

test("到期复习页签渲染队列与复测按钮", () => {
  // nextReviewAt 设为今天上午前，确保落在「今日队列」默认筛选下
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const html = renderToString(React.createElement(ui.DueReviewList, {
    records: [record({ nextReviewAt: today.toISOString() })],
    reviewCurves: REVIEW_CURVES_ARRAY,
    action: actionStub,
    manualTodayIds: [],
    setManualTodayIds: noop
  }))
  assert.doesNotMatch(html, /今日队列|完成评价后立即显示下次复习日期/)
  assert.match(html, /计划到期状态/)
  assert.match(html, /class="reviewHandwriteAction" aria-label="书写 第 1 题"/)
  assert.match(html, /展开筛选/)
  assert.match(html, /reviewFilterPanel/)
  assert.match(html, /reviewToolbar[\s\S]*reviewActionCapsule/)
  // Explicit contract: the review toolbar reuses the settings surface and slider.
  assert.match(html, /class="settingsCapsule reviewToolbar"/)
  assert.match(html, /class="settingsCapsuleSlider"/)
  assert.doesNotMatch(html, /reviewLiquid|reviewCapsuleGoo|reviewToolbarSlider/)
  assert.match(html, /aria-label="排序"/)
  assert.match(html, /reviewStartButton[\s\S]*开始复习/)
  assert.match(html, /展开全部题目/)
  assert.doesNotMatch(html, /reviewStartGlass|<canvas/)
  assert.doesNotMatch(html, /复习计划概览/)
  assert.match(html, /第 1 题/)
  assert.match(html, /不会/)
})

test("错题详情侧栏渲染题目视图与等级选择", () => {
  const item = record()
  const html = renderToString(React.createElement(ui.MistakeDetail, {
    detail: detailFor(item),
    customCategories: ["计算题"],
    action: actionStub,
    reloadDetail: asyncNoop,
    onRemoved: noop
  }))
  assert.match(html, /第 1 题/)
  assert.match(html, /定位原题/)
  assert.match(html, /不会/)
})

test("场景错题详情使用包内交互预览页，不嵌入srcDoc和data图片", () => {
  const runtime = globalThis as any
  runtime.window.__MN_SCENE_ENABLED__ = true
  try {
    const value = detailFor(record())
    value.questionHtml = '<html><body><img src="data:image/png;base64,blocked"></body></html>'
    const html = renderToString(React.createElement(ui.MistakeDetail, {
      detail: value, customCategories: [], action: actionStub, reloadDetail: asyncNoop, onRemoved: noop
    }))
    assert.match(html, /<iframe[^>]+src="\/pkg\/web-dist\/preview.html"/)
    assert.doesNotMatch(html, /srcDoc|srcdoc|data:image/)
  } finally { delete runtime.window.__MN_SCENE_ENABLED__ }
})

test("导出页签渲染题目筛选与页面设置", () => {
  const records = [record(), record({ recordId: "b:2", sourceNoteId: "2", sourceTitle: "第 2 题", level: 1 })]
  const html = renderToString(React.createElement(ui.MistakeExport, {
    allRecords: records,
    action: actionStub,
    onBack: noop,
  }))
  assert.match(html, /导出错题/)
  assert.match(html, /> 返回</)
  assert.match(html, /筛选题目/)
  assert.match(html, /复习状态/)
  assert.match(html, /选择内容/)
  assert.match(html, /设置文件/)
  assert.match(html, /每页题目密度/)
  assert.match(html, /答案位置/)
  assert.match(html, /导出顺序/)
  assert.match(html, /快速预览/)
  assert.match(html, /脑图/)
  assert.match(html, /请选择至少一个学习集 \/ 脑图/)
  assert.doesNotMatch(html, /错题本筛选结果/)
  assert.doesNotMatch(html, /手动选择题目|基础范围|每组题目后/)
  assert.doesNotMatch(html, /按顺序完成题目|固定密度会预留相应书写区/)

  const selectedHtml = renderToString(React.createElement(ui.MistakeExport, {
    allRecords: records,
    initialRecordIds: [records[0].recordId],
    action: actionStub,
    onBack: noop,
  }))
  assert.match(selectedHtml, /<strong>1<\/strong> 道可用错题符合条件/)
  assert.doesNotMatch(selectedHtml, /<strong>2<\/strong> 道可用错题符合条件/)
})

test("设置页核心组件：等级复习曲线引导在对象/数组两种形态下都不崩", () => {
  for (const curves of [REVIEW_CURVES_ARRAY, REVIEW_CURVES_OBJECT]) {
    const html = renderToString(React.createElement(ui.MistakeLevelGuide, {
      reviewCurves: curves as number[][],
      action: actionStub
    }))
    assert.match(html, /错题分类说明/)
    assert.match(html, /不会/)
    assert.match(html, /掌握/)
  }
})

test('待复习设置显示复习反馈且无小字，开关沿用已有偏好键', async () => {
  for (const enabled of [undefined, false, true]) {
    const commands: any[] = []
    const element = ui.ReviewFeedbackSettings({
      matching: { reviewCompletionConfetti: enabled },
      action: async (...args: any[]) => { commands.push(args) }
    })
    const html = renderToString(element)
    assert.match(html, /待复习设置/)
    assert.match(html, /aria-label="复习反馈"/)
    assert.doesNotMatch(html, /复习完成烟花|复习完成时与结果弹窗一起播放/)
    const row = html.match(/<button[^>]*><i>[\s\S]*?<strong>复习反馈<\/strong>[\s\S]*?<\/button>/)?.[0]
    assert.ok(row)
    assert.doesNotMatch(row.slice(row.lastIndexOf('<strong>')), /<small>/)
    assert.match(html, /<small>题目预览默认展开前 2 条<\/small>/)
    const items = element.props.items
    const feedback = items.find((item: any[]) => item[1] === '复习反馈')
    assert.equal(feedback[4].props.checked, enabled !== false)
    await feedback[3]()
    assert.deepEqual(commands, [['setPersonalSetting', { key: 'reviewCompletionConfetti', value: enabled === false }]])
  }
})

test("设置页核心组件：正则规则设置与设置分组渲染", () => {
  const group = renderToString(React.createElement(ui.SettingsGroup, {
    title: "答案匹配",
    items: [["bind", "绑定答案脑图", "描述文字", noop]]
  }))
  assert.match(group, /答案匹配/)
  const regex = renderToString(React.createElement(ui.RegexMatchingSettings, {
    matching: { mode: "regex", regexRules: { questionPattern: "(\\d+)", answerPattern: "(\\d+)" } },
    action: actionStub
  }))
  assert.match(regex, /正则规则匹配/)
})

test("刷新确认弹窗渲染", () => {
  const consent = renderToString(React.createElement(ui.MistakeRefreshConsent, {
    onAccept: noop,
    onCancel: noop
  }))
  assert.match(consent, /.+/)
})

test("联通测试结果只显示测试 1/2 与状态，不显示端点网址", () => {
  const html = renderToString(React.createElement(ui.ConnectivityResult, {
    result: {
      testedAt: new Date().toISOString(),
      results: [
        { key: "测试1", reachable: true, accepted: true, statusCode: 204, durationMs: 12 },
        { key: "测试2", reachable: false, error: "无响应", durationMs: 8000 }
      ]
    }
  }))
  assert.match(html, /联通测试结果/)
  assert.match(html, /测试1/)
  assert.match(html, /测试2/)
  assert.match(html, /HTTP 204/)
  assert.doesNotMatch(html, /https?:\/\//)
})
