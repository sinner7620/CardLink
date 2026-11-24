import { ConversationSearch } from "@/components/assistant-ui/elements/conversation-search"
import { MessageBranches } from "@/components/assistant-ui/elements/message-branches"
import { Button } from "@/components/ui/button"
import { useEffect, useMemo, useState } from "react"
import { SearchIcon, SparklesIcon } from "lucide-react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { EvidencePanel } from "../../HarnessEvidence"
import { AppSidebar } from "./app-sidebar"
import { ChatHeader } from "./chat-header"
import { Thread } from "@/components/assistant-ui/elements/thread.aui"
import { CardLinkRuntimeProvider, THREAD_COMPONENTS } from "./assistant-runtime"
import { useHarnessChat } from "./use-harness-chat"


function SceneGuide() {
  return (
    <div className="agentPanel harness-ui relative flex h-full flex-col px-4 pt-12 pb-4" data-scene="false">
      <Empty className="mx-auto my-6 max-w-[460px] bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon"><SparklesIcon /></EmptyMedia>
          <EmptyTitle>需要启用 MN5 场景模式</EmptyTitle>
          <EmptyDescription>
            请在场景模板设置中启用 CardLink，然后重新打开 AI 分析。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

/** ChatMessage(parts) → EvidencePanel 需要的 tool_result 形状（证据抽屉按工具结果查记录）。 */
function toolResultsOf(messages) {
  return messages.flatMap((message) => (message.parts || [])
    .filter((part) => part.type?.startsWith("tool-") && part.output !== undefined)
    .map((part) => ({
      type: "tool_result",
      toolCallId: part.toolCallId,
      content: { tool: part.type.slice(5), data: part.output },
    })))
}

function ConversationNavigation({ chat }) {
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const view = chat.branchView
  const visibleMessages = chat.messages
  const hits = useMemo(() => {
    const needle = query.trim()
    if (!needle) return []
    const lower = needle.toLocaleLowerCase()
    return visibleMessages.flatMap((message, index) => {
      const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n")
      const match = text.toLocaleLowerCase().indexOf(lower)
      return match < 0 ? [] : [{
        id: message.id,
        before: text.slice(Math.max(0, match - 24), match),
        match: text.slice(match, match + needle.length),
        after: text.slice(match + needle.length, match + needle.length + 32),
        position: (index / Math.max(1, visibleMessages.length - 1)) * 100,
      }]
    })
  }, [query, visibleMessages])
  useEffect(() => {
    const hit = searching && hits[index]
    if (!hit) return
    document.getElementById("cardlink-message-" + hit.id)?.scrollIntoView({ block: "center" })
  }, [hits, index, searching])
  if (!chat.activeSessionId || !visibleMessages.length) return null
  const branches = view?.branches ?? []
  return <div className="flex items-start gap-2 border-b border-border px-4 py-1.5">
    {branches.length > 1 ? <MessageBranches compact disabled={chat.running || chat.sessionLoading}
      aria-label="会话分支" variants={branches.map((item) => item.id)}
      index={branches.findIndex((item) => item.id === view.branchId)}
      onIndexChange={(selection) => { void chat.selectBranch(branches[selection].id) }} /> : null}
    <Button type="button" variant="ghost" size="icon-sm" aria-label="搜索当前分支" aria-expanded={searching}
      onClick={() => setSearching((open) => !open)}><SearchIcon /></Button>
    {searching && <ConversationSearch query={query} hits={hits} activeIndex={index}
      onQueryChange={(value) => { setQuery(value); setIndex(0) }}
      onStep={hits.length ? (delta) => setIndex((index + delta + hits.length) % hits.length) : undefined} />}
  </div>
}

export function ChatShell({ onOpenSettings }) {
  const chat = useHarnessChat()
  const toolResults = useMemo(() => toolResultsOf(chat.messages), [chat.messages])
  const [deleteTarget, setDeleteTarget] = useState(null)
  if (!chat.sceneReady) return <SceneGuide />

  const active = chat.activeSession
  const title = active ? (active.title || active.lastPreview || "未命名会话") : "AI 分析"

  return (
    <TooltipProvider delayDuration={200}>
      <div className="agentPanel harness-ui relative flex h-full min-h-0 flex-col bg-sidebar pt-12" data-scene="true">
        <div className="relative flex min-h-0 flex-1">
          <SidebarProvider className="min-h-0 flex-1" defaultOpen style={{ "--sidebar-width": "15rem" }}>
            <CardLinkRuntimeProvider chat={chat} requestDelete={setDeleteTarget}>
              <AppSidebar chat={chat} deleteTarget={deleteTarget} onCloseDelete={() => setDeleteTarget(null)} />
              <SidebarInset aria-labelledby="agent-session-title" className="min-h-0 overflow-hidden bg-background p-0">
                <ChatHeader chat={chat} title={title} onOpenSettings={onOpenSettings} />
                <ConversationNavigation key={chat.branchView?.branchId} chat={chat} />
                <div className="relative min-h-0 flex-1 overflow-hidden bg-background pb-12">
                  <Thread autoFocus={false} components={THREAD_COMPONENTS} />
                </div>
              </SidebarInset>
            </CardLinkRuntimeProvider>
          </SidebarProvider>
        </div>

        {chat.evidenceId || chat.recordRef ? (
          <EvidencePanel
            diagnostic={chat.diagnostic}
            evidenceId={chat.evidenceId}
            onClose={chat.closeEvidence}
            recordId={chat.recordRef}
            sessionId={chat.activeSessionId}
            branchId={chat.branchView?.branchId}
            sessionMessages={toolResults}
          />
        ) : null}
      </div>
    </TooltipProvider>
  )
}
