"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser session; created lazily so server renders don't share it.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2_000, retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider delayDuration={200}>{children}</Tooltip.Provider>
    </QueryClientProvider>
  );
}
