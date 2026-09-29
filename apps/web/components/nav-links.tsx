"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Top-bar links; the current section is marked for screen readers and in ink. */
export function NavLinks() {
  const path = usePathname();
  const inDatasets = path.startsWith("/datasets") || path.startsWith("/runs");
  return (
    <div className="ml-auto flex items-center gap-item text-small">
      <Link href="/datasets" aria-current={inDatasets ? "page" : undefined} className={cn("hover:text-ink", inDatasets ? "font-medium text-ink" : "text-graphite")}>
        Your datasets
      </Link>
      <Link href="/" aria-current={path === "/" ? "page" : undefined} className="rounded-control border border-hairline-strong bg-sheet px-3 py-1.5 font-medium hover:border-ink">
        New list
      </Link>
    </div>
  );
}
