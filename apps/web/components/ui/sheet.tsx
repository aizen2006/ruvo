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
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-ink/25" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-xl animate-sheet-in flex-col bg-sheet shadow-raised focus:outline-none sm:inset-y-2 sm:right-2 sm:rounded-sheet",
          className,
        )}
        {...props}
      >
        <header className="flex items-start gap-item border-b border-hairline px-group py-item">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-heading font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-small text-graphite">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">Details</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="-mr-2 rounded-control p-2 text-graphite hover:bg-ink/5 hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-group py-group">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
