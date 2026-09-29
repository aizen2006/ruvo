import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A placeholder block while content loads: a field of plus marks with a denser band passing through. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("dither rounded-control", className)} {...props} />;
}
