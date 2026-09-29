"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Top-bar links in mono; the current section is marked for screen readers and in ink. */
export function NavLinks() {
  const path = usePathname();
  const inDatasets = path.startsWith("/datasets") || path.startsWith("/runs");
  return (
    <div className="ml-auto flex items-center gap-group font-mono text-small">
      <Link href="/datasets" aria-current={inDatasets ? "page" : undefined} className={cn("hover:text-ink", inDatasets ? "text-ink" : "text-graphite")}>
        Your datasets
      </Link>
      <Link href="/" aria-current={path === "/" ? "page" : undefined} className={buttonVariants({ size: "sm" })}>
        New list
      </Link>
    </div>
  );
}
