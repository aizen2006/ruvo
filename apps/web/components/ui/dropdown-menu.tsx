import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Shared by menus and selects: a frosted panel, and mono items that invert to ink when highlighted. */
export const menuPanel = "frost z-50 min-w-48 animate-fade-in rounded-panel p-1.5";
export const menuItem =
  "flex cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2 font-mono text-small outline-none select-none data-[highlighted]:bg-ink data-[highlighted]:text-sheet data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content sideOffset={sideOffset} className={cn(menuPanel, className)} {...props} />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item className={cn(menuItem, className)} {...props} />;
}
