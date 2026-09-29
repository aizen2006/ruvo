"use client";

import { Toaster as Sonner } from "sonner";

/** Short confirmations after an action ("Started", "Stopped"), styled to the tokens. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: "!rounded-panel !border-hairline !bg-ink !text-sheet !shadow-raised !font-sans !text-small",
          description: "!text-sheet/75",
        },
      }}
    />
  );
}

export { toast } from "sonner";
