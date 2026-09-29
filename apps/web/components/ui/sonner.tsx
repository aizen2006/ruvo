"use client";

import { Toaster as Sonner } from "sonner";

/** Short confirmations after an action ("Started", "Stopped"): a frosted panel with a mono line. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: "!frost !rounded-panel !border-0 !font-mono !text-small !text-ink",
          description: "!text-graphite",
        },
      }}
    />
  );
}

export { toast } from "sonner";
