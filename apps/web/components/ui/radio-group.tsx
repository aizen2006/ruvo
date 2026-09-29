import { RadioGroup as RadioPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioPrimitive.Root>) {
  return <RadioPrimitive.Root className={cn("grid gap-tight", className)} {...props} />;
}

/**
 * A choice shown as a flat tile. The chosen tile fills with signal and its text turns ink; the
 * square in its corner fills too, so the choice never rests on colour alone. Arrow keys move
 * between tiles (Radix).
 */
export function RadioTile({ className, children, ...props }: ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      className={cn(
        "relative flex h-full flex-col items-start rounded-control border border-hairline-strong bg-sheet py-3 pr-8 pl-item text-left transition-colors duration-(--duration-fast) hover:border-graphite",
        "data-[state=checked]:border-ink data-[state=checked]:bg-highlighter data-[state=checked]:**:text-ink",
        "after:absolute after:top-4 after:right-3.5 after:size-2 after:border after:border-graphite data-[state=checked]:after:border-ink data-[state=checked]:after:bg-ink",
        className,
      )}
      {...props}
    >
      {children}
    </RadioPrimitive.Item>
  );
}
