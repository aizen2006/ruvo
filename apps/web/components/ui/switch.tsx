import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-7 w-12 shrink-0 cursor-pointer items-center border-2 border-ink bg-sheet p-0.5 transition-colors duration-(--duration-base) data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {/* A square ink thumb that turns highlighter when on. */}
      <SwitchPrimitive.Thumb className="block size-5 bg-ink transition-transform duration-(--duration-base) data-[state=checked]:translate-x-5 data-[state=checked]:bg-highlighter" />
    </SwitchPrimitive.Root>
  );
}
