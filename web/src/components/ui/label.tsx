import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/** shadcn/ui Label：与 Input 组合使用，保证表单标签点击可聚焦。 */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-xs leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
