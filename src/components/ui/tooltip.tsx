import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * The one thing on this page a reader has to be told rather than shown: how the
 * availability bar counts, and what its four colours mean. `title` was doing that
 * job and does it badly -- it cannot be styled, it waits about a second, it is
 * offered to a mouse only (the icon is not focusable), it never appears on a
 * touch screen, and a browser surfaces it to assistive technology as a name
 * rather than a description. Radix gives all four back: hover and focus both
 * open it, Escape closes it, and the content is wired to the trigger with
 * `aria-describedby`.
 *
 * Vendored rather than installed from a registry, like the rest of this folder.
 * shadcn's version wraps every root in its own provider so a caller does not have
 * to mount one at the app root; that is kept, with a shorter delay than the 700ms
 * default, since this tooltip explains a chart the reader is already looking at.
 */
function TooltipProvider({ delayDuration = 200, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        // The popover pair, the same surface the bar's own hover uses: a tooltip
        // that opened in a different colour from the hover two rows below it
        // would read as two different layers of the page.
        className={cn(
          "z-50 w-fit max-w-64 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-pop",
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_1px)] rotate-45 rounded-[2px] border-r border-b bg-popover fill-popover" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
