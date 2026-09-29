"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { isClientError } from "@/lib/api";

/** Retry once on network or server errors; a 4xx answer will not change. */
const retry = (failures: number, error: Error) => !isClientError(error) && failures < 1;

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser session; created lazily so server renders don't share it.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2_000, retry } } }));
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider delayDuration={200}>
        {children}
        <Toaster />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
