import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-control border-2 border-ink bg-sheet px-3 text-left text-small font-semibold hover:bg-highlighter-wash data-[placeholder]:text-pencil data-[state=open]:bg-highlighter",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={6}
        className={cn(
          "z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden border-2 border-ink bg-sheet p-1 shadow-raised",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** An option with an optional second line (e.g. a model's price). */
export function SelectItem({ children, hint, className, ...props }: ComponentProps<typeof SelectPrimitive.Item> & { hint?: ReactNode }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-pointer flex-col rounded-control py-2 pr-3 pl-8 text-small outline-none select-none data-[highlighted]:bg-highlighter data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute top-2.5 left-2.5">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {hint && <span className="text-micro text-graphite">{hint}</span>}
    </SelectPrimitive.Item>
  );
}
