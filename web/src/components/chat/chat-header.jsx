import { BugIcon, DownloadIcon, MoreHorizontalIcon, RefreshCwIcon, Settings2Icon } from "lucide-react"
import { memo } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"

/** 会话标题与 CardLink 专属操作。 */
function formatDataAsOf(value) {
  const time = Date.parse(String(value ?? ""))
  return Number.isFinite(time) ? new Date(time).toLocaleString() : "—"
}

function freshnessView(freshness) {
  const status = freshness?.status
  if (status === "current") {
    return { label: "数据已同步", tone: "text-emerald-600", dot: "bg-emerald-500", hint: `本地错题与 OCR 与快照一致 · 数据时间 ${formatDataAsOf(freshness?.dataAsOf)}` }
  }
  if (status === "stale") {
    return { label: "本地数据已更新", tone: "text-amber-600", dot: "bg-amber-500", hint: `可同步新快照；已开始的运行仍读原快照，下一轮使用新版本 · 上次同步 ${formatDataAsOf(freshness?.dataAsOf)}` }
  }
  return { label: "数据状态未知", tone: "text-muted-foreground", dot: "bg-muted-foreground/50", hint: freshness?.reason || "尚未同步或无法判断本地源；答案卡片正文的修改需同步刷新" }
}

/** v2.16 §6.3：本地源新鲜度与同步入口（打开会话时自动检查，不常驻轮询）。 */
function DataFreshnessStatus({ chat }) {
  const { freshness, running, syncSnapshot } = chat
  const view = freshnessView(freshness)
  return (
    <button
      aria-label={`数据新鲜度：${view.label}`}
      className="hidden max-w-56 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted sm:inline-flex"
      data-slot="data-freshness"
      disabled={running}
      onClick={() => { void syncSnapshot() }}
      title={`${view.hint}${running ? "（运行中不能同步）" : "。点击同步快照"}`}
      type="button"
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${view.dot}`} />
      <span className={`truncate ${view.tone}`}>{view.label}</span>
      <span className="truncate text-muted-foreground">{formatDataAsOf(freshness?.dataAsOf)}</span>
    </button>
  )
}

function PureChatHeader({ chat, title, onOpenSettings }) {
  const { snapshot, diagnostic, running, activeSessionId, syncSnapshot, toggleDiagnostic, exportSession } = chat
  const { isMobile } = useSidebar()

  return (
    <header className="sticky top-0 flex h-12 min-h-12 items-center gap-2 border-b border-foreground/10 bg-background px-4 md:px-5" data-slot="agent-toolbar">
      {isMobile ? <SidebarTrigger aria-label="打开会话侧栏" type="button" /> : null}
      <h1 className="min-w-0 truncate text-[13px] font-medium text-sidebar-foreground" id="agent-session-title">{title}</h1>
      <DataFreshnessStatus chat={chat} />

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button aria-label="会话操作" className="ml-auto text-sidebar-foreground/60" size="icon-sm" variant="ghost">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={running} onSelect={() => { void syncSnapshot() }}>
            <RefreshCwIcon />
            <span className="flex-1">同步快照</span>
            <span className="text-[10px] text-muted-foreground">{snapshot.id ? "已同步" : "未同步"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleDiagnostic}>
            <BugIcon />
            <span className="flex-1">诊断模式</span>
            <span className="text-[10px] text-muted-foreground">{diagnostic ? "开" : "关"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={running || !activeSessionId} onSelect={() => { void exportSession() }}>
            <DownloadIcon />导出会话
          </DropdownMenuItem>
          {onOpenSettings ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenSettings}>
                <Settings2Icon />模型设置
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

export const ChatHeader = memo(PureChatHeader)
