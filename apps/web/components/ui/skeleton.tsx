import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A placeholder block while content loads. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse bg-newsprint", className)} {...props} />;
}
