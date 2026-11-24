import { ChevronDownIcon, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { BUDGET_OPTIONS } from "./use-harness-chat"

/**
 * v2.16 §11.3：运行预算档位选择器。
 * 由用户显式选择、随会话保存；档位在 Run 入列时固定，模型没有选择或扩大预算的通道。
 */
export function BudgetTierMenu({ chat }) {
  const { budgetTier, budgetBusy, running, activeSessionId, applyBudgetTier } = chat
  const current = BUDGET_OPTIONS.find((item) => item.value === budgetTier)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`运行预算档位：${current?.label || "未设置"}`}
          className="gap-1 rounded-lg px-2 text-xs text-muted-foreground"
          data-slot="budget-tier"
          disabled={budgetBusy || running || !activeSessionId}
          size="sm"
          type="button"
          variant="outline"
        >
          <Gauge className="size-3.5" />
          {current?.label || "运行预算"}
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8}>
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          本 Run 迭代 / 工具上限
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={(value) => { void applyBudgetTier(value) }} value={budgetTier}>
          {BUDGET_OPTIONS.map((item) => (
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
