import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A placeholder block while content loads. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-ink/6", className)} {...props} />;
}
