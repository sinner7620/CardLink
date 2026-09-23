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
const REVIEW_CURVES_ARRAY = [[1, 3, 7], [2, 5, 10], [14]]
// 面板侧历史上的白屏正是把对象形态的 REVIEW_CURVES 当数组用；两条形态都要能渲染。
const REVIEW_CURVES_OBJECT = { 0: [1, 3, 7], 1: [2, 5, 10], 2: [14] } as unknown as number[][]

test("OCR 结果 Markdown 含图片和链接时可安全渲染", () => {
  assert.doesNotThrow(() => ui.renderMarkdownPreview("# 原题\n![电路图](assets/q1.png)\n[参考链接](https://example.com)"))
  const html = ui.renderMarkdownPreview("![电路图](assets/q1.png) 与 [参考链接](https://example.com)")
  assert.match(html, /\[图片：电路图\]/)
  assert.match(html, /参考链接/)
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
  assert.match(html, /今日队列/)
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
  assert.match(html, /更多筛选与排序/)
  assert.match(html, /快速预览/)
  assert.match(html, /请选择脑图/)
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
  assert.match(selectedHtml, /筛选得到 1 道可用错题/)
  assert.doesNotMatch(selectedHtml, /筛选得到 2 道可用错题/)
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
