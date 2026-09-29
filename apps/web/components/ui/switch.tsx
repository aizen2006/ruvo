import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-hairline-strong bg-canvas p-0.5 transition-colors duration-(--duration-base) data-[state=checked]:border-ink data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4.5 rounded-full bg-sheet shadow-sm transition-transform duration-(--duration-base) data-[state=checked]:translate-x-4 data-[state=checked]:bg-highlighter" />
    </SwitchPrimitive.Root>
  );
}
