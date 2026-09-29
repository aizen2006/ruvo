import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The tinted overlay under dialogs and sheets; the frosted panel above it is the only thing that floats. */
export function Overlay() {
  return <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-ink/20" />;
}

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
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "frost fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 animate-fade-in rounded-sheet p-group focus:outline-none",
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
