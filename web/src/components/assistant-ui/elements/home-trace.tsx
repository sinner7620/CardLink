// assistant-ui MIT source, apps/docs/components/shared/trace-line.tsx and
// apps/docs/components/pages/home/demo/trace.tsx, revision 294e932dbb073b75ebc3c24540f98909a64f18c9.
"use client";

import { type ReactNode } from "react";
import { ShimmerLabel } from "@/components/assistant-ui/elements/surfaces";
import { cn } from "@/lib/utils";
import { CollapsibleTrigger } from "./collapsible-root";

/**
 * The mark every trace line carries. A disclosure rotates it and a plain line
 * does not, so the two read as the same grammar rather than two symbols; it
 * stays a glyph rather than an icon because an icon on a line that cannot open
 * reads as an affordance.
 */
export function TraceMarker({
  live,
  className,
}: {
  live: boolean;
  className?: string;
}): ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 transition-transform",
        live ? "text-blue-500" : "text-muted-foreground/50",
        className,
      )}
    >
      {">"}
    </span>
  );
}

export function TraceLine({
  live,
  label,
  detail,
  meta,
}: {
  live: boolean;
  label: string;
  detail?: string;
  meta?: string;
}): ReactNode {
  return (
    <div className="my-1 flex items-baseline gap-2 font-mono text-[12px] [font-variant-ligatures:none]">
      <TraceMarker live={live} />
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {live ? (
          <ShimmerLabel>
            {label}
            {detail ? ` ${detail}` : null}
          </ShimmerLabel>
        ) : (
          <>
            {label}
            {detail ? ` ${detail}` : null}
          </>
        )}
      </span>
      {meta ? (
        <span className="text-muted-foreground/50 shrink-0">{meta}</span>
      ) : null}
    </div>
  );
}

export const disclosureContentClass =
  "border-foreground/10 ms-[5px] border-s ps-4";

export function DisclosureTrigger({
  live,
  label,
  detail,
}: {
  live: boolean;
  label: string;
  detail?: string;
}): ReactNode {
  return (
    <CollapsibleTrigger className="group/trigger my-1 flex max-w-full cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 text-left font-mono text-[12px] outline-none [font-variant-ligatures:none] focus-visible:underline">
      <TraceMarker
        live={live}
        className="group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90"
      />
      <span className="text-muted-foreground group-hover/trigger:text-foreground min-w-0 truncate transition-colors">
        {live ? (
          <ShimmerLabel>
            {label}
            {detail ? ` ${detail}` : null}
          </ShimmerLabel>
        ) : (
          <>
            {label}
            {detail ? ` ${detail}` : null}
          </>
        )}
      </span>
    </CollapsibleTrigger>
  );
}
