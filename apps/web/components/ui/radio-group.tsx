import { RadioGroup as RadioPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioPrimitive.Root>) {
  return <RadioPrimitive.Root className={cn("grid gap-tight", className)} {...props} />;
}

/**
 * A choice shown as a tile. The chosen tile gets the highlighter bar on its left edge and an ink
 * border; arrow keys move between tiles (Radix).
 */
export function RadioTile({ className, children, ...props }: ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      className={cn(
        "group relative flex h-full flex-col items-start overflow-hidden rounded-panel border border-hairline-strong bg-sheet px-item py-3 text-left transition-colors duration-(--duration-fast) hover:border-graphite data-[state=checked]:border-ink",
        "before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-highlighter before:opacity-0 before:transition-opacity data-[state=checked]:before:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
    </RadioPrimitive.Item>
  );
}
