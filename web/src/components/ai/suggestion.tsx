import * as React from "react"
import { cn } from "../../lib/harness-cn"

/**
 * AI Elements Suggestion / Suggestions（Harness 版）。
 * 空态示例问题：哑组件，点击行为由调用方注入。
 */

export type SuggestionsProps = React.ComponentProps<"div">

export const Suggestions = ({ className, ...props }: SuggestionsProps) => (
  <div
    data-slot="suggestions"
    className={cn("flex flex-wrap items-center justify-center gap-1.5", className)}
    {...props}
  />
)

export type SuggestionProps = React.ComponentProps<"button"> & {
  suggestion?: string
}

export const Suggestion = ({ suggestion, className, children, ...props }: SuggestionProps) => (
  <button
    {...props}
    type="button"
    data-slot="suggestion"
    className={cn(
      "inline-flex items-center rounded-full border border-border bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
      className
    )}
  >
    {children ?? suggestion}
  </button>
)
