import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactNode } from "react";

/** A short explanation on hover or focus. Keep it to a sentence; never hide required information in one. */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 max-w-64 animate-fade-in rounded-control bg-ink px-3 py-2 text-micro text-sheet shadow-raised"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
