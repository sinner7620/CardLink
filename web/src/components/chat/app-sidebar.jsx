import { AgentStatus } from "@/components/assistant-ui/elements/agent-status"
import { ThreadSearchInput } from "@/components/assistant-ui/elements/thread-search"
import { useState } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ThreadListItems, ThreadListNew, ThreadListRoot } from "@/components/assistant-ui/elements/thread-list.aui"
import { Button } from "@/components/ui/button"
import { Sidebar, SidebarContent, SidebarHeader, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"

export function AppSidebar({ chat, deleteTarget, onCloseDelete }) {
  const { running, sessionQuery, setSessionQuery, deleteSession, purgeSession } = chat
  const { isMobile, state } = useSidebar()
  const [forceDelete, setForceDelete] = useState(false)

  function closeDelete() {
    setForceDelete(false)
    onCloseDelete()
  }

  async function remove(action) {
    if (!deleteTarget) return
    const result = await action(deleteTarget.id, forceDelete)
    if (result?.needsForce) setForceDelete(true)
    else closeDelete()
  }

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-12 shrink-0 flex-row items-center justify-between border-b border-foreground/10 px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="text-[13px] font-medium group-data-[collapsible=icon]:hidden">CardLink</span>
          <SidebarTrigger aria-label={isMobile ? "关闭会话侧栏" : state === "collapsed" ? "展开会话侧栏" : "收起会话侧栏"} />
        </SidebarHeader>
        <SidebarContent className="px-3 pt-3 group-data-[collapsible=icon]:hidden">
          <ThreadListRoot>
            <ThreadListNew className="w-full border border-foreground/10 bg-background" disabled={running} />
            <ThreadSearchInput value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} />
            {chat.pendingQuestion || chat.running ? <AgentStatus
              state={chat.pendingQuestion ? "waiting" : "working"}
              label={chat.pendingQuestion ? "等待回答" : "会话运行中"} /> : null}
            {chat.backgroundRuns?.filter((id) => id !== chat.activeSessionId).map((id) => {
              const item = chat.sessions.find((session) => session.id === id)
              return <AgentStatus key={id} state="working"
                label={(item?.title || item?.lastPreview || "后台会话") + "运行中"} />
            })}
            <ThreadListItems />
          </ThreadListRoot>
        </SidebarContent>
      </Sidebar>
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) { closeDelete() } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{forceDelete ? "会话正在运行" : "删除会话"}</AlertDialogTitle>
            <AlertDialogDescription>
              {forceDelete
                ? `「${deleteTarget?.title || deleteTarget?.lastPreview || "未命名会话"}」仍在运行。确认后将先取消运行，再执行所选的删除方式。`
                : `删除「${deleteTarget?.title || deleteTarget?.lastPreview || "未命名会话"}」？「删除」仅从列表移除，消息与审计仍保留在本地数据库；「彻底删除」会物理清除该会话的消息、运行、审计与证据记录，且不可恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              onClick={() => { void remove(purgeSession) }}
              size="sm"
              type="button"
              variant="destructive"
            >
              彻底删除
            </Button>
            <Button type="button" onClick={() => { void remove(deleteSession) }}>
              {forceDelete ? "取消运行并删除" : "删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
