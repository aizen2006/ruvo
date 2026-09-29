import { RadioGroup as RadioPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioPrimitive.Root>) {
  return <RadioPrimitive.Root className={cn("grid gap-tight", className)} {...props} />;
}

/**
 * A choice shown as a block with an ink frame. The chosen block fills with highlighter; arrow
 * keys move between tiles (Radix).
 */
export function RadioTile({ className, children, ...props }: ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      className={cn(
        "group relative flex h-full flex-col items-start border-2 border-ink bg-sheet px-item py-item text-left transition-colors duration-(--duration-fast) hover:bg-highlighter-wash focus-visible:z-10 data-[state=checked]:bg-highlighter",
        className,
      )}
      {...props}
    >
      {children}
    </RadioPrimitive.Item>
  );
}
