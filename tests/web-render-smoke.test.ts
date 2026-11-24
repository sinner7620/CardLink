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
    onSourcesRefreshed: noop
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

// P4-3 Harness 组件冒烟（回归：HarnessSyncCard 曾引用未定义的 onOpenSettings 导致总览闪退，
// 本地构建不执行该分支，只有逐组件 renderToString 能抓住）。
execFileSync(process.execPath, [join(projectRoot, "scripts/build-web-smoke-agent.mjs")], {
  cwd: projectRoot,
  stdio: "pipe"
})
const uiAgent = require(join(projectRoot, "output/web-smoke-agent.cjs")) as Record<string, any>

test("AI 运行阶段显示思考、审核、工具执行和整理回答", () => {
  for (const [phase, label] of [
    ["assistant_pending", "思考中"],
    ["review_pending", "正在审核工具调用"],
    ["tool_pending", "正在执行工具"],
    ["final_pending", "正在整理回答"],
  ]) {
    const html = renderToString(React.createElement(uiAgent.RunIndicator, { phase }))
    assert.match(html, /role="status"/)
    assert.ok(html.includes(label))
  }
})

test("AI 上下文面板显示有效上下文、精确阈值和摘要复用状态", () => {
  const html = renderToString(React.createElement(uiAgent.ContextInsights, {
    chat: {
      messages: [{ type: "user", text: "继续" }],
      activeSessionId: "session",
      status: "ready",
      contextUsage: {
        context: { estimatedInputTokens: 8000, inputBudgetTokens: 20480, compactionTriggerTokens: 17408, compactionStatus: "reused" },
        compactionCount: 1,
      },
    },
  })).replace(/<!-- -->/g, "")
  assert.match(html, /有效上下文 8,000 \/ 20,480 Token（估算）/)
  assert.match(html, /压缩阈值 17,408 Token/)
  assert.match(html, /已复用历史摘要/)
  assert.match(html, /累计压缩 1 次/)
  assert.match(html, /上下文详情/)
})

test("v2.14 上下文详情：上游构成条/趋势图/费用卡（dsh-context · dsh-cost-meter 移植）", () => {
  const html = renderToString(React.createElement(uiAgent.ContextInsights, {
    defaultOpen: true,
    chat: {
      activeSessionId: "session",
      insightsState: "ready",
      contextUsage: {
        context: { estimatedInputTokens: 8000, inputBudgetTokens: 20480, compactionTriggerTokens: 17408, compactionStatus: "compacted", outputBudgetTokens: 16384, reservedTokens: 4096 },
        usage: { promptTokens: 1250, completionTokens: 320, totalTokens: 1570, estimated: false },
        compactionCount: 2,
      },
      insights: {
        sessionId: "session",
        generatedAt: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        windowDays: 7,
        limit: 8,
        offset: 0,
        requestCount: 2,
        hasMore: true,
        totals: {
          requests: 2, delivered: 1, failed: 1, cancelled: 0, notSent: 0, unconfirmed: 0,
          promptTokens: 1250, completionTokens: 320, promptMissing: 1, completionMissing: 1,
          promptEstimated: 1, completionEstimated: 1,
          breakdown: { instructionTokens: 1700, compactionTokens: 300, toolDefinitionTokens: 240, messageTokens: 400, toolResultTokens: 120, overheadTokens: 16, totalTokens: 2776 },
        },
        requests: [
          {
            requestSeq: 2, attempt: 2, runId: "run-2", createdAt: new Date().toISOString(), outcome: "delivered",
            providerId: "cardlink-device", model: "deepseek-chat",
            breakdown: { instructionTokens: 800, compactionTokens: 300, toolDefinitionTokens: 240, messageTokens: 400, toolResultTokens: 120, overheadTokens: 8, totalTokens: 1868 },
            budget: { inputBudgetTokens: 20480, outputBudgetTokens: 16384, reservedTokens: 4096, compactionTriggerTokens: 17408 },
            compaction: { id: "cmp-1", applied: true, triggerReason: "budget" },
            tokens: { prompt: 1250, completion: 320, total: 1570, promptSource: "provider", completionSource: "estimated", estimated: true, missing: false },
            deltaInputTokens: -300,
            cost: { currency: "CNY", amount: 0.0123, inputAmount: 0.0025, outputAmount: 0.0026, estimated: true },
          },
          {
            requestSeq: 1, attempt: 1, runId: "run-1", createdAt: new Date().toISOString(), outcome: "failed",
            providerId: "cardlink-device", model: "deepseek-chat",
            breakdown: { instructionTokens: 800, compactionTokens: 0, toolDefinitionTokens: 240, messageTokens: 1000, toolResultTokens: 120, overheadTokens: 8, totalTokens: 2168 },
            budget: { inputBudgetTokens: 20480, outputBudgetTokens: 16384, reservedTokens: 4096, compactionTriggerTokens: 17408 },
            compaction: null,
            tokens: { prompt: undefined, completion: undefined, total: undefined, missing: true, estimated: false },
            deltaInputTokens: null,
            cost: null,
          },
        ],
        cost: {
          scope: "assistant_requests",
          session: [
            { currency: "CNY", amount: 0.0123, requests: 1, pricedRequests: 1, unpricedRequests: 0, missingUsageRequests: 1 },
            { currency: null, amount: null, requests: 1, pricedRequests: 0, unpricedRequests: 1, missingUsageRequests: 0 },
          ],
          today: [{ currency: "CNY", amount: 0.0123, requests: 1, pricedRequests: 1, unpricedRequests: 0, missingUsageRequests: 0 }],
          days: [{ date: "2026-11-16", buckets: [{ currency: "CNY", amount: 0.0123, requests: 1, pricedRequests: 1, unpricedRequests: 0, missingUsageRequests: 0 }] }],
          truncated: false,
        },
      },
    },
  })).replace(/<!-- -->/g, "")
  // §11.1 摘要行（现有进入点，文案不变）
  assert.match(html, /有效上下文 8,000 \/ 20,480 Token（估算）/)
  assert.match(html, /本轮总用量 1,570 Token（服务商实报）/)
  assert.match(html, /累计压缩 2 次/)
  // dsh-context CurrentComposition：data-lc-current + 概览数字 + 构成条 + 图例
  assert.match(html, /data-lc-current/)
  assert.match(html, /当前上下文/)
  assert.match(html, /lc-overview-num/)
  assert.match(html, /lc-overview-pct/)
  assert.match(html, /lc-stacked/)
  assert.match(html, /lc-stacked-seg/)
  assert.match(html, /lc-legend/)
  assert.match(html, /lc-chip/)
  // 窗口 C = 输入预算 + 输出预留 + 安全余量，各自以遮罩/触发线呈现
  assert.match(html, /lc-reserve-output/)
  assert.match(html, /lc-reserve-headroom/)
  assert.match(html, /lc-trigger/)
  // dsh-context TrendChart：轴/网格/柱/轮次行/压缩标记
  assert.match(html, /lc-chartrow/)
  assert.match(html, /lc-axis-top/)
  assert.match(html, /lc-grid-zero/)
  assert.match(html, /lc-bar-stack/)
  assert.match(html, /lc-cat-seg/)
  assert.match(html, /lc-bar-marker/)
  assert.match(html, /lc-turns/)
  // H1 分项名（键与颜色来自上游 CATS）
  assert.match(html, /系统指令/)
  assert.match(html, /压缩摘要/)
  // 请求事实：预算、用量来源、单次费用（缺失显示未知）
  assert.match(html, /输入预算/)
  assert.match(html, /服务商实报/)
  assert.match(html, /¥0\.0123/)
  // dsh-cost-meter 卡片与按日表
  assert.match(html, /cm-cards/)
  assert.match(html, /cm-card-title/)
  assert.match(html, /cm-card-value/)
  assert.match(html, /cm-table/)
  assert.match(html, /未配置费率/)
  assert.match(html, /lc-foot/)
  assert.match(html, /仅统计 Assistant 请求/)
  // 不泄露任何内部记录/证据标识
  assert.ok(!/recordId|evidenceId|bookA0000/.test(html))
})

test("v2.14 上下文详情：空态、错误态与加载态（上游 lc-empty / lc-error / lc-skel）", () => {
  const empty = renderToString(React.createElement(uiAgent.ContextInsights, {
    defaultOpen: true,
    chat: {
      activeSessionId: "session",
      insightsState: "ready",
      contextUsage: { context: { estimatedInputTokens: 0, inputBudgetTokens: 20480, compactionTriggerTokens: 17408 }, compactionCount: 0 },
      insights: {
        sessionId: "session", generatedAt: new Date().toISOString(), timezone: "UTC", windowDays: 7, limit: 8, offset: 0,
        requestCount: 0, hasMore: false,
        totals: { requests: 0, delivered: 0, failed: 0, cancelled: 0, notSent: 0, unconfirmed: 0, promptTokens: 0, completionTokens: 0, promptMissing: 0, completionMissing: 0, promptEstimated: 0, completionEstimated: 0, breakdown: { instructionTokens: 0, compactionTokens: 0, toolDefinitionTokens: 0, messageTokens: 0, toolResultTokens: 0, overheadTokens: 0, totalTokens: 0 } },
        requests: [],
        cost: { scope: "assistant_requests", session: [], today: [], days: [], truncated: false },
      },
    },
  }))
  assert.match(empty, /lc-empty/)
  assert.match(empty, /发起一轮对话后，这里会展示每次模型请求的上下文构成/)

  const failed = renderToString(React.createElement(uiAgent.ContextInsights, {
    defaultOpen: true,
    chat: {
      activeSessionId: "session",
      insightsState: "error",
      insightsError: "请求遥测未装配",
      contextUsage: { context: { estimatedInputTokens: 100, inputBudgetTokens: 20480 }, compactionCount: 0 },
    },
  }))
  assert.match(failed, /lc-error-msg/)
  assert.match(failed, /请求遥测未装配/)
  assert.match(failed, /lc-error-retry/)
  assert.match(failed, /重试/)

  const loading = renderToString(React.createElement(uiAgent.ContextInsights, {
    defaultOpen: true,
    chat: { activeSessionId: "session", insightsState: "loading" },
  }))
  assert.match(loading, /lc-skel-plot/)
  assert.match(loading, /正在读取/)
})
test("总览 AI 数据报告卡可渲染（props 名一致性）", () => {
  const html = renderToString(React.createElement(uiAgent.HarnessSyncCard, { onOpenAgent: noop, onOpenSettings: noop }))
  assert.match(html, /AI 数据报告/)
  assert.match(html, /只读快照口径/)
  // onOpenSettings / onOpenAgent 两个回调都要真正渲染出入口（b4 曾因属性名不一致整卡崩溃）
  assert.match(html, /模型与密钥设置/)
  assert.match(html, /打开 AI 分析/)
})

test("AI 分析面板在非场景环境渲染开启引导（§12.7）", () => {
  const html = renderToString(React.createElement(uiAgent.AgentPanel, { onOpenSettings: noop }))
  assert.match(html, /需要启用 MN5 场景模式/)
})

test("AI 分析设置使用官方设置面板显示初始读取状态", () => {
  const html = renderToString(React.createElement(uiAgent.HarnessSettings, { onBack: noop }))
  assert.match(html, /data-slot="settings-panel"/)
  assert.match(html, /正在读取 AI 设置/)
  assert.match(html, /返回设置/)
})

test("工具调用记录渲染参数与结果（CodeBlock 路径）", () => {
  const html = renderToString(React.createElement(uiAgent.ToolResultSmoke))
  assert.match(html, /getMistakeStats/)
  assert.match(html, /已执行/)
  assert.match(html, /totalRecords/)
  assert.match(html, /免审/)
  assert.ok(!/已审核/.test(html), "免审调用不得标注为已审核（§10.1）")
  assert.ok(!/CodeBlock/.test(html), "不应把未定义的 CodeBlock 渲染成文本")
})

test("对话区渲染用户/助手消息与证据引用", () => {
  const html = renderToString(React.createElement(uiAgent.ConversationSmoke))
  assert.match(html, /快到期的错题/)
  assert.match(html, /data-slot="message"/)
  assert.match(html, /data-slot="sources"/)
  assert.match(html, /1 处证据引用/)
  // Response 用 React 节点渲染 Markdown，不产生原始 HTML 文本
  assert.match(html, /<strong/)
  assert.ok(!/\*\*共 3 条\*\*/.test(html), "Markdown 标记不应原样输出")
})

test("v2.4 第三阶段：Markdown 表格/GFM/代码块渲染", () => {
  const html = renderToString(React.createElement(uiAgent.MarkdownSmoke))
  // GFM 表格 + 对齐（研究结论：对齐走内联 style）
  assert.match(html, /<table/)
  assert.match(html, /<th[^>]*>/)
  assert.match(html, /不会/)
  assert.match(html, /<code class="hljs language-js">/)
  assert.match(html, /<code class="language-rust">let answer = 42;/)
  // 标题层级
  assert.match(html, /<h2/)
})

test("v2.4 第三阶段：行内/块级数学公式（KaTeX）与定界符归一化", () => {
  const html = renderToString(React.createElement(uiAgent.MarkdownSmoke))
  // 行内 $…$ → KaTeX HTML
  assert.match(html, /katex/)
  // 单行 $$…$$ 归一化为 display（katex-display 才有横向滚动容器）
  assert.match(html, /katex-display/)
  // 矩阵渲染（pmatrix）
  assert.match(html, /pmatrix|vlist/)
  // 括号变体 \[..\] \(..\) 归一化
  assert.match(html, /e\^\{i\\pi\}|kaTeX|katex-html/)
  assert.ok(!/\\\[/.test(html.replace(/&#x5C;/g, "")), "括号定界符不应原样输出")
})

test("v2.4 第三阶段：不可信 Markdown 的安全默认（§12.5）", () => {
  const html = renderToString(React.createElement(uiAgent.MarkdownSmoke))
  // 原始 HTML 转义：不产出 <img>/<script> 元素
  assert.ok(!/<img[\s>]/.test(html), "原始 <img> 不得渲染为元素")
  assert.ok(!/<script/.test(html), "原始 <script> 不得渲染为元素")
  // javascript: 协议被 defaultUrlTransform 清空
  assert.ok(!/javascript:/.test(html), "javascript: URL 不得保留")
  // 原始 HTML 以转义文本形式可读
  assert.match(html, /&lt;img|onerror/)
})

test("v2.4 第五阶段：工具结构化视图与消息操作栏（§5.1/§5.3）", () => {
  const html = renderToString(React.createElement(uiAgent.ToolBodyViewSmoke))
  // 统计结构化视图（中文指标名），不再以裸 JSON 为主视图
  assert.match(html, /错题总数/)
  assert.match(html, /应复习（Harness 口径）/)
  assert.ok(!/currentLevelReviewCountSum/.test(html), "统计视图不得以原始字段名为主输出")
  // 消息操作栏：复制 + 重新生成
  assert.match(html, /aria-label="复制消息"/)
  assert.match(html, /aria-label="重新生成回答"/)
})

test("v2.4 第四阶段：AnswerPresenter 渲染真实标题引用与降级（§10.1.1）", () => {
  const html = renderToString(React.createElement(uiAgent.AnswerPresenterSmoke))
  // 正文标题链接（card: 引用，可点击形态）
  assert.match(html, /泰勒展开求极限/)
  assert.match(html, /data-citation="card"/)
  assert.match(html, /data-citation="stat"/)
  // 来源清单触发器计数（折叠内容 Radix 默认不挂载，展开项见下方 sourceItemsOf 断言）
  assert.match(html, /3 处证据引用/)
  // 正文不得残留引用标记
  assert.ok(!/\{\{card:/.test(html), "正文不得残留引用标记")
})

test("v2.4 §10.1.1：引用/来源的可见文本与属性都不得泄露内部 ID", () => {
  const html = renderToString(React.createElement(uiAgent.AnswerPresenterSmoke))
  // 正文标题、链接 title 属性、来源项都只能是真实标题/降级文案
  assert.ok(!/bookA0000000000000000000000000001/.test(html), "UI 不得输出 recordId")
  assert.ok(!/card:/.test(html), "UI 不得输出 card: 协议串")
  assert.ok(!/stat:/.test(html), "UI 不得输出 stat: 协议串")
})

test("v2.4 §12：诊断模式之外不显示 argsHash / evidenceId（工具卡）", () => {
  const normal = renderToString(React.createElement(uiAgent.ToolCallSmoke))
  assert.ok(!/argsHash/.test(normal), "普通模式不得显示 argsHash")
  assert.ok(!/ev_00000000000000000000000000000001/.test(normal), "普通模式不得显示 evidenceId")
  const diagnostic = renderToString(React.createElement(uiAgent.ToolCallSmoke, { diagnostic: true }))
  assert.match(diagnostic, /argsHash/, "诊断模式显示 argsHash")
  assert.match(diagnostic, /ev_00000000000000000000000000000001/, "诊断模式显示 evidenceId")
})

test("v2.4 §12：记录卡默认不显示 recordId，诊断模式才显示", () => {
  const normal = renderToString(React.createElement(uiAgent.RecordCardSmoke))
  assert.match(normal, /泰勒展开求极限/)
  assert.ok(!/bookA0000000000000000000000000001/.test(normal), "普通模式不得显示 recordId")
  const diagnostic = renderToString(React.createElement(uiAgent.RecordCardSmoke, { diagnostic: true }))
  assert.match(diagnostic, /bookA0000000000000000000000000001/, "诊断模式显示 recordId")
})

test("v2.4 第四阶段：来源清单映射——DTO/标题兜底/降级（§10.1.1）", () => {
  const { sourceItemsOf } = uiAgent
  // citations DTO：真实标题 + 笔记本 + 统计标签 + 降级项
  const items = sourceItemsOf({
    citations: [
      { type: "card", recordId: "a:b", title: "泰勒展开求极限", notebookTitle: "高数·上", available: true },
      { type: "card", recordId: "a:gone", available: false },
      { type: "stat", statsId: "snap1@x", label: "错题统计（getMistakeStats）", available: true },
    ],
  })
  assert.deepEqual(items.map((i: { label: string }) => i.label), ["泰勒展开求极限", "引用不可用", "错题统计（getMistakeStats）"])
  assert.equal(items[0].sub, "高数·上")
  assert.equal(items[2].kind, "stat")
  // 无 citations 时回退 evidenceRefs + resolveRecordTitles 标题映射
  const fallback = sourceItemsOf(
    { evidenceRefs: ["a:b", "a:gone"] },
    { "a:b": { available: true, title: "泰勒展开求极限" }, "a:gone": { available: false } },
  )
  assert.deepEqual(fallback.map((i: { label: string }) => i.label), ["泰勒展开求极限", "引用不可用"])
  // 无任何标题数据时不输出裸 recordId（普通用户不得看到内部标识），标记为待解析
  const raw = sourceItemsOf({ evidenceRefs: ["a:b"] })
  assert.equal(raw[0].label, "来源待解析")
  assert.equal(raw[0].available, false)
})

test("AI Elements 输入区渲染发送按钮", () => {
  const html = renderToString(React.createElement(uiAgent.PromptInputSmoke))
  assert.match(html, /aria-label="发送"/)
  assert.match(html, /placeholder="询问错题情况"/)
})

test("App 顶层壳在无数据时可渲染", () => {
  const html = renderToString(React.createElement(ui.App))
  assert.match(html, /错题本/)
  assert.match(html, /topNav/)
  assert.match(html, /answerMatchingDialog updatePrompt/, "更新确认弹窗应复用设置页对话框样式")
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

test("点击的链接目标即使不匹配搜索也在错题列表单独显示选中行", () => {
  const matching = record()
  const target = record({ recordId: "b:2", sourceNoteId: "2", sourceTitle: "链接题目甲" })
  const html = renderToString(React.createElement(ui.MistakeBrowser, {
    records: [matching],
    allRecords: [matching, target],
    selectedId: target.recordId,
    listLocation: { recordId: target.recordId },
    detail: null,
    query: "第 1 题",
    searchScopes: ["title"],
  }))
  assert.match(html, /class="mistakeItem selected[^"]*"[^>]*>[\s\S]*?<strong>链接题目甲<\/strong>/)
  assert.match(html, /<strong>第 1 题<\/strong>/)
  assert.match(html, /aria-label="搜索错题"[^>]*value="第 1 题"/)
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

test("打开已逾期题目的复习页时显示逾期天数", () => {
  const startToday = new Date().setHours(0, 0, 0, 0)
  const item = record({ nextReviewAt: new Date(startToday - 2 * 86400000).toISOString() })
  const html = renderToString(React.createElement(ui.DueReviewList, {
    records: [item],
    focusRecordId: item.recordId,
    reviewCurves: REVIEW_CURVES_ARRAY,
    action: actionStub,
    manualTodayIds: [],
  }))
  assert.match(html, /第 1 题/)
  assert.match(html, /已逾期 2 天/)
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

test("错题详情将已收录题名渲染为链接，未收录题名只显示文字", () => {
  const html = renderToString(React.createElement(ui.MistakeDetail, {
    detail: {
      ...detailFor(record()),
      linkedQuestions: [
        { noteId: "2", title: "已收录题目", recordId: "book:2" },
        { noteId: "3", title: "未收录题目" },
      ],
    },
    customCategories: [], action: actionStub, reloadDetail: asyncNoop, onRemoved: noop,
  }))
  assert.match(html, /<a[^>]*href="#mistake=book%3A2"[^>]*>已收录题目<\/a>/)
  assert.match(html, /<span[^>]*>未收录题目<\/span>/)
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

test("更新确认弹窗按 Release 原 Markdown 渲染常见格式", () => {
  const prompt = {
    version: "9.9.9", channel: "正式版", source: "GitHub", currentVersion: "2.4.8-b84",
    notes: "纯文本摘要（旧原生版本才会用到）",
    notesMarkdown: [
      "# 更新说明",
      "",
      "## 折叠优先",
      "",
      "正文含**加粗**、*斜体*与 `行内码`。",
      "",
      "- 无序项",
      "1. 有序项",
      "",
      "| 版本 | 内容 |",
      "| --- | --- |",
      "| b84 | 表格 |",
      "",
      "```js",
      "const answer = 42",
      "```",
      "",
      "> 引用段落",
      "",
      "[Release 页](https://example.com/releases/9.9.9)"
    ].join("\n")
  }
  const html = renderToString(React.createElement(ui.UpdatePromptNotes, { prompt }))
  assert.match(html, /class="updatePromptNotes"/)
  assert.match(html, /data-slot="update-prompt-markdown"/)
  assert.match(html, /updatePromptMarkdown/)
  assert.match(html, /<h1[^>]*>更新说明<\/h1>/)
  assert.match(html, /<h2[^>]*>折叠优先<\/h2>/)
  assert.match(html, /<strong>加粗<\/strong>/)
  assert.match(html, /<em>斜体<\/em>/)
  assert.match(html, /<code>行内码<\/code>/)
  assert.match(html, /<ul>/)
  assert.match(html, /<ol>/)
  assert.match(html, /<table>/)
  assert.match(html, /mdTableScroll/)
  assert.match(html, /<pre>/)
  assert.match(html, /<blockquote>/)
  assert.match(html, /<a[^>]*href="https:\/\/example\.com\/releases\/9\.9\.9"/, "绝对 http(s) 链接保留 href")
  assert.match(html, /<a[^>]*target="_blank"/, "外链在新窗口打开，不同帧导航")
  assert.match(html, /<a[^>]*rel="noopener noreferrer nofollow"/, "外链有 rel 保护")
  assert.ok(!html.includes("纯文本摘要"), "有原 Markdown 时不再显示纯文本摘要")
  assert.ok(!html.includes("| --- |"), "表格标记不应原样出现")
  assert.ok(!html.includes("katex"), "更新说明不经过 AI 数学预处理")
})

test("更新说明：HTML 被忽略，mailto/card/stat/相对/无效链接只显示文字且没有伪按钮", () => {
  const prompt = {
    version: "9.9.9", channel: "正式版", source: "GitHub", currentVersion: "2.4.8-b84", notes: "",
    notesMarkdown: [
      "原始 HTML：<img src=x onerror=\"alert(1)\"> 与 <script>alert(1)</script> 结束",
      "",
      "[邮件](mailto:someone@example.com)",
      "",
      "[卡片](card:record-1)",
      "",
      "[统计](stat:stat-1)",
      "",
      "[相对](./release-notes.md)",
      "",
      "[协议相对](//example.com/x)",
      "",
      "[无效](http://)",
      "",
      "![截图](https://example.com/tracker.png)"
    ].join("\n")
  }
  const html = renderToString(React.createElement(ui.UpdatePromptNotes, { prompt }))
  // skipHtml：原始 HTML 直接丢弃，不产生元素，也不留转义文本
  assert.ok(!/<img[\s>]/.test(html), "原始 <img> 不得渲染为元素")
  assert.ok(!/<script/.test(html), "原始 <script> 不得渲染为元素")
  assert.ok(!/onerror/.test(html), "skipHtml 应丢弃原始 HTML，而不是显示其文本")
  // 非 http(s) 与无法解析的地址都不生成 href
  assert.ok(!/href="mailto:/.test(html))
  assert.ok(!/href="card:/.test(html))
  assert.ok(!/href="stat:/.test(html))
  assert.ok(!/href="\.\//.test(html))
  assert.ok(!/href="\/\//.test(html))
  assert.ok(!/href="http:\/\/"/.test(html))
  assert.ok(!/javascript:/.test(html))
  // 没有可点击/按钮语义
  assert.ok(!/role="button"/.test(html))
  assert.ok(!/data-citation/.test(html))
  assert.ok(!/tabindex="0"/.test(html))
  // 文字仍可读
  for (const text of ["邮件", "卡片", "统计", "相对", "协议相对", "无效"]) assert.match(html, new RegExp(text))
  // 远端图片不产生资源请求，只显示 alt/地址文字
  assert.match(html, /data-slot="md-image"/)
  assert.match(html, /截图/)
  assert.ok(!html.includes("tracker.png\""), "图片地址不应成为可请求的 src")
})

test("旧载荷与空正文在弹窗里回退到纯文本说明", () => {
  const legacy = renderToString(React.createElement(ui.UpdatePromptNotes, {
    prompt: { version: "9.9.8", channel: "正式版", source: "GitHub", currentVersion: "2.4.8-b84", notes: "只有旧摘要" }
  }))
  assert.match(legacy, /updatePromptPlainNotes/)
  assert.match(legacy, /只有旧摘要/)
  assert.ok(!legacy.includes("updatePromptMarkdown"))

  const blank = renderToString(React.createElement(ui.UpdatePromptNotes, { prompt: { notes: "" } }))
  assert.match(blank, /暂无更新说明/)

  const missing = renderToString(React.createElement(ui.UpdatePromptNotes, { prompt: null }))
  assert.match(blank, /暂无更新说明/)
  assert.match(missing, /暂无更新说明/)
})