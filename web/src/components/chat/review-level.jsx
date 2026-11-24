import { ChevronDownIcon, ShieldCheckIcon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { REVIEW_LEVELS } from "./use-harness-chat"

export function ReviewLevelMenu({ chat }) {
  const { reviewLevel, levelBusy, running, activeSessionId, pickReviewLevel } = chat
  const current = REVIEW_LEVELS.find((item) => item.value === reviewLevel)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`工具审核档位：${current?.label || "未设置"}`}
          className="gap-1 rounded-lg px-2 text-xs text-muted-foreground"
          data-slot="review-level"
          disabled={levelBusy || running || !activeSessionId}
          size="sm"
          type="button"
          variant="outline"
        >
          <ShieldCheckIcon className="size-3.5" />
          {current?.label || "审核档位"}
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8}>
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          工具调用审核档位
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={(value) => { pickReviewLevel(value) }} value={reviewLevel}>
          {REVIEW_LEVELS.map((item) => (
            <DropdownMenuRadioItem className="cursor-pointer" key={item.value} value={item.value}>
              <span className="flex flex-col">
                <span>{item.label}</span>
                <span className="text-[10px] text-muted-foreground">{item.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ReviewLevelConfirm({ chat }) {
  const { pendingLevel, levelBusy, applyReviewLevel, setPendingLevel } = chat
  return (
    <AlertDialog open={pendingLevel === "full_allow"} onOpenChange={(open) => { if (!open) setPendingLevel("") }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>切换到「完全允许」</AlertDialogTitle>
          <AlertDialogDescription>
            工具调用将跳过模型审核，仍受权限检查、只读白名单和审计约束。发送给模型的数据范围不变。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={levelBusy}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={levelBusy} onClick={() => { void applyReviewLevel("full_allow") }}>
            确认切换
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
