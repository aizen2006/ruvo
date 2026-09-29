import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A centred dialog for short confirmations. */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
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
          "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 animate-fade-in rounded-sheet bg-sheet p-group shadow-raised focus:outline-none",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="text-heading font-semibold">{title}</DialogPrimitive.Title>
        {description && <DialogPrimitive.Description className="mt-2 text-small text-graphite">{description}</DialogPrimitive.Description>}
        <div className="mt-group">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
