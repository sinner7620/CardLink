import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

// shadcn/ui Collapsible(registry 复制式,§3.1)
function Collapsible(props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger(props) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent(props) {
  return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
