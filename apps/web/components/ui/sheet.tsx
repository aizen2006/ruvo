import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A panel that slides in from the right over the page (the receipt drawer). Built on Dialog, so
 * focus is trapped, Escape closes it, and focus returns to what opened it.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  title,
  description,
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: ReactNode; description?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-ink/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-xl animate-sheet-in flex-col border-l-4 border-ink bg-sheet focus:outline-none",
          className,
        )}
        {...props}
      >
        {/* A black masthead: the title set big and condensed, like a magazine's section opener. */}
        <header className="on-ink flex items-start gap-item bg-ink px-group pt-group pb-item text-sheet">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="font-display text-[2.25rem] leading-[0.95] font-black text-balance">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-tight text-small text-sheet/80">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">Details</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="-mt-2 -mr-2 p-2 text-sheet hover:bg-highlighter hover:text-ink" aria-label="Close">
            <X className="size-6" />
          </DialogPrimitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-group py-group">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
