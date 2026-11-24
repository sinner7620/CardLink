"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Official Registry trigger; CardLink supplies the verified local evidence drawer.
const citationTriggerClass = "bg-foreground/[0.06] text-muted-foreground hover:text-foreground/90 data-[popup-open]:bg-foreground data-[popup-open]:text-background ms-0.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-[5px] px-1 align-middle font-mono text-[10px] font-medium tabular-nums transition-colors motion-reduce:transition-none";

export function CitationButton({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" data-slot="inline-citation" className={cn(citationTriggerClass, className)} {...props} />;
}

export interface InlineCitationProps extends ComponentProps<"p"> {}

export function InlineCitation({
  children,
  className,
  ...props
}: InlineCitationProps) {
  return (
    <p
      data-slot="inline-citation"
      className={cn(
        "text-foreground/90 max-w-sm text-sm leading-relaxed",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}
