"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Top-bar links on the black bar; the current section is marked for screen readers and with a thick rule. */
export function NavLinks() {
  const path = usePathname();
  const inDatasets = path.startsWith("/datasets") || path.startsWith("/runs");
  return (
    <div className="ml-auto flex items-center gap-group text-small font-semibold">
      <Link
        href="/datasets"
        aria-current={inDatasets ? "page" : undefined}
        className={cn("border-b-4 py-1 hover:border-highlighter", inDatasets ? "border-highlighter" : "border-transparent text-sheet/80 hover:text-sheet")}
      >
        Your datasets
      </Link>
      <Link href="/" aria-current={path === "/" ? "page" : undefined} className="bg-sheet px-4 py-2 font-bold text-ink hover:bg-highlighter">
        New list
      </Link>
    </div>
  );
}
