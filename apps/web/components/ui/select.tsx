import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { menuItem, menuPanel } from "./dropdown-menu";
import { field } from "./input";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(field, "flex h-10 items-center justify-between gap-2 text-left font-mono text-small data-[placeholder]:text-pencil", className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="size-4 text-graphite" />
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
        className={cn(menuPanel, "max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden", className)}
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
    <SelectPrimitive.Item className={cn(menuItem, "group relative flex-col items-start gap-0 pl-8", className)} {...props}>
      <SelectPrimitive.ItemIndicator className="absolute top-2.5 left-2.5">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {hint && <span className="text-micro text-graphite group-data-[highlighted]:text-sheet/70">{hint}</span>}
    </SelectPrimitive.Item>
  );
}
