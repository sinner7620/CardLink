"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { paper } from "./surfaces";

const DOT_DELAYS = ["-0.32s", "-0.16s", "0s"];

// Upstream: https://r.assistant-ui.com/elements-typing-indicator.json
export function TypingIndicator({
  variant = "bubble",
  label = "Assistant is typing",
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "variant" | "role" | "aria-label"
> & {
  variant?: "bubble" | "bare";
  label?: string;
}) {
  const dots = DOT_DELAYS.map((delay) => (
    <span
      key={delay}
      aria-hidden
      className="bg-foreground/40 size-1.5 animate-bounce rounded-full motion-reduce:animate-none"
      style={{ animationDelay: delay, animationDuration: "1.1s" }}
    />
  ));

  if (variant === "bare") {
    return (
      <div
        data-slot="typing-indicator"
        data-variant="bare"
        role="status"
        aria-label={label}
        className={cn("flex gap-1", className)}
        {...props}
      >
        {dots}
      </div>
    );
  }

  return (
    <div
      data-slot="typing-indicator"
      data-variant="bubble"
      className={cn(paper, "w-fit rounded-full px-4 py-3.5", className)}
      {...props}
    >
      <div
        role="status"
        aria-label={label}
        className="flex gap-1"
      >
        {dots}
      </div>
    </div>
  );
}
