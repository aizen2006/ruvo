"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Shown when a page crashes while rendering: try it again, or go somewhere that works. */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="max-w-2xl space-y-group border-t-8 border-ink pt-group">
      <h1 className="font-display text-display font-black">Something went wrong</h1>
      <p className="text-heading text-graphite">{error.message || "This page couldn't be shown."}</p>
      <div className="flex flex-wrap gap-tight">
        <Button variant="primary" onClick={retry}>
          Try again
        </Button>
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
