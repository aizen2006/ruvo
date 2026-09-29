"use client";

import { Toaster as Sonner } from "sonner";

/** Short confirmations after an action ("Started", "Stopped"), styled to the tokens. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: "!rounded-none !border-0 !border-l-8 !border-highlighter !bg-ink !text-sheet !shadow-none !font-sans !text-small !font-bold",
          description: "!text-sheet/75",
        },
      }}
    />
  );
}

export { toast } from "sonner";
