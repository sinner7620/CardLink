import { AgentPanel } from "./AgentPanel"
import { ContextInsights } from "./components/chat/context-insights"
import { CardLinkToolResult, RunIndicator } from "./components/chat/assistant-runtime"
import { AnswerPresenter, sourceItemsOf } from "./components/ai/answer-presenter"
import { RecordCard, ToolBodyView } from "./components/ai/tool-views"
import { MessageActions } from "./components/ai/message-actions"
import { HarnessSyncCard } from "./HarnessSyncCard"
import { HarnessSettings } from "./HarnessSettings"
import { Conversation, ConversationContent } from "./components/ai/conversation"
import { Message, MessageAvatar, MessageContent } from "./components/ai/message"
import { Response } from "./components/ai/response"
import { PromptInput, PromptInputTextarea, PromptInputToolbar, PromptInputSubmit } from "./components/ai/prompt-input"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./components/ai/tool"
import { Source, Sources, SourcesContent, SourcesTrigger } from "./components/ai/sources"

// 供渲染冒烟测试逐组件 renderToString（tests/web-render-smoke.test.ts）。
// 补强：Tool 结果渲染与 PromptInput 都曾在渲染/提交路径引用未定义符号，
// 只有真正 renderToString 才能抓住（构建与 pnpm check 都不覆盖 web TSX）。

/** 工具结果卡片：覆盖 CodeBlock / 状态徽标 / 参数与结果两段渲染。 */
function ToolResultSmoke() {
  return (
    <Tool defaultOpen>
      <ToolHeader title="getMistakeStats" state="output-available" audit="skipped" />
      <ToolContent>
        <ToolInput input={{ argsHash: "abc123" }} />
        <ToolOutput output={{ totalRecords: 5, levelCounts: { "0": 1, "1": 2, "2": 2 }, dueCount: 3 }} />
      </ToolContent>
    </Tool>
  )
}

/** 对话区：用户/助手两条消息 + 可折叠证据引用。 */
function ConversationSmoke() {
  return (
    <Conversation>
      <ConversationContent>
        <Message from="user"><MessageContent><p>我有哪些快到期的错题？</p></MessageContent></Message>
        <Message from="assistant">
          <div>
            <MessageAvatar from="assistant" />
            <MessageContent>
              <Response content={"**共 3 条**\n\n- 不会 1 条\n- 不熟 2 条"} />
              <Sources>
                <SourcesTrigger count={1} />
                <SourcesContent>
                  <Source title="questions:q1" />
                </SourcesContent>
              </Sources>
            </MessageContent>
          </div>
        </Message>
      </ConversationContent>
    </Conversation>
  )
}

/** 输入区：AI Elements PromptInput 表单（含提交按钮）。 */
function PromptInputSmoke() {
  return (
    <PromptInput status="ready" onSubmit={() => {}}>
      <PromptInputTextarea placeholder="询问错题情况" />
      <PromptInputToolbar>
        <PromptInputSubmit status="ready" />
      </PromptInputToolbar>
    </PromptInput>
  )
}

/** v2.4 §10.1.1 AnswerPresenter：标题链接 + 引用清单（含降级项），不泄露内部 ID 于正文。 */
function AnswerPresenterSmoke() {
  return (
    <AnswerPresenter
      text={"建议优先复习 [《泰勒展开求极限》](card:bookA0000000000000000000000000001:noteA001)。本次共统计 [统计](stat:snap1@2026-11-15T08:00:00Z)。"}
      citations={[
        { type: "card", ref: "ref_1", recordId: "bookA0000000000000000000000000001:noteA001", title: "泰勒展开求极限", notebookTitle: "高数·上", level: 0, available: true },
        { type: "card", ref: "ref_2", recordId: "bookA0000000000000000000000000001:noteGONE", available: false },
        { type: "stat", ref: "ref_3", statsId: "snap1@2026-11-15T08:00:00Z", label: "错题统计（getMistakeStats）", available: true },
      ]}
    />
  )
}

/** v2.4 §5.3/§5.1：工具结构化视图（替代裸 JSON）+ 消息操作栏。 */
function ToolBodyViewSmoke() {
  return (
    <div>
      <ToolBodyView
        toolName="getMistakeStats"
        data={{
          totalRecords: 5, availableRecords: 4, levelCounts: { "0": 1, "1": 2, "2": 2 },
          dueCount: 3, reviewedRecordCount: 2, totalReviewActions: 6, currentLevelReviewCountSum: 9,
          params: { timezone: "Asia/Shanghai", dueBoundary: "2026-11-16T00:00:00+08:00" },
        }}
      />
      <MessageActions text="示例回答文本" onRegenerate={() => {}} />
    </div>
  )
}

/** §12 诊断模式：工具卡默认不显示 argsHash/evidenceId，开启诊断才显示。 */
function ToolCallSmoke({ diagnostic }) {
  const call = {
    toolCallId: "call-1",
    toolName: "getMistakeStats",
    executionStatus: "executed",
    argsHash: "args-hash-123",
    evidenceJson: JSON.stringify({ evidenceId: "ev_00000000000000000000000000000001", snapshotId: "snap-1" }),
    resultJson: JSON.stringify({
      ok: true,
      tool: "getMistakeStats",
      data: {
        totalRecords: 5, availableRecords: 4, levelCounts: { "0": 1, "1": 2, "2": 2 },
        dueCount: 3, reviewedRecordCount: 2, currentLevelReviewCountSum: 9,
        params: { timezone: "Asia/Shanghai", dueBoundary: "2026-11-16T00:00:00+08:00" },
      },
    }),
    reviewerApproved: true,
    reviewerReason: "ok",
  }
  return (
    <CardLinkToolResult
      diagnostic={diagnostic === true}
      toolName={call.toolName}
      call={call}
      result={JSON.parse(call.resultJson).data}
    />
  )
}

/** §12 记录卡：默认不显示 recordId；诊断模式才显示。 */
function RecordCardSmoke({ diagnostic }) {
  return (
    <RecordCard
      diagnostic={diagnostic === true}
      record={{
        recordId: "bookA0000000000000000000000000001:noteA001",
        sourceTitle: "泰勒展开求极限",
        sourceNotebookTitle: "高数·上",
        sourcePathTitles: ["极限"],
        categoryPath: ["高数", "极限"],
        level: 0,
        reviewCount: 2,
        reviewCompleted: false,
        nextReviewAt: "2026-11-16T00:00:00+08:00",
      }}
    />
  )
}

/** v2.4 第三阶段：Markdown/GFM/KaTeX/安全渲染冒烟（含 LLM 常见定界符变体）。 */
const MARKDOWN_SAMPLE = [
  "## 统计结论",
  "",
  "**共 3 条** 快到期，其中 $x^2+1$ 型 1 条。",
  "",
  "| 等级 | 数量 |",
  "| --- | ---: |",
  "| 不会 | 1 |",
  "| 不熟 | 2 |",
  "",
  "单行块级公式：",
  "",
  "$$\\frac{a}{b}+\\sum_{i=1}^{n} i$$",
  "",
  "矩阵：",
  "",
  "$$",
  "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}",
  "$$",
  "",
  "括号变体 \\[e^{i\\pi}+1=0\\] 与行内 \\(a_1\\)。",
  "",
  "```js",
  "const n = 1",
  "```",
  "",
  "```rust",
  "let answer = 42;",
  "```",
  "",
  "原始 HTML：<img src=x onerror=alert(1)> 与 [坏链接](javascript:alert(1)) 应被中和。",
].join("\n")

function MarkdownSmoke() {
  return <Response content={MARKDOWN_SAMPLE} />
}

export { AgentPanel, ContextInsights, RunIndicator, HarnessSyncCard, HarnessSettings, ToolResultSmoke, ConversationSmoke, PromptInputSmoke, MarkdownSmoke, AnswerPresenterSmoke, sourceItemsOf, ToolBodyViewSmoke, ToolCallSmoke, RecordCardSmoke }
