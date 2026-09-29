import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A pill toggle: a sunk grey track that turns ink, and a raised thumb that turns signal when on. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-hairline p-[3px] shadow-[inset_0_1px_2px_rgb(0_0_0/0.18)] transition-colors duration-(--duration-base) data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4.5 rounded-full bg-sheet shadow-[0_1px_2px_rgb(0_0_0/0.3),inset_0_1px_0_#fff] transition-[translate,background-color] duration-(--duration-base) ease-(--ease-standard) data-[state=checked]:translate-x-4 data-[state=checked]:bg-highlighter" />
    </SwitchPrimitive.Root>
  );
}
