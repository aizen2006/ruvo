import Link from "next/link";
import { ApiError } from "@/lib/api";
import { Button } from "./button";

/**
 * A full-page message when a page cannot show its content: what happened and what to do next.
 * Used for missing datasets and an unreachable server.
 */
export function PageNotice({ error, what }: { error: unknown; what: string }) {
  const missing = error instanceof ApiError && error.status === 404;
  const message = missing
    ? `This ${what} doesn't exist. It may have been deleted, or the link is incomplete.`
    : error instanceof Error
      ? error.message
      : `The ${what} couldn't be loaded.`;
  return (
    <div className="max-w-xl space-y-item py-section">
      <h1 className="text-title font-semibold">{missing ? `${what[0]!.toUpperCase()}${what.slice(1)} not found` : "Something went wrong"}</h1>
      <p className="text-graphite">{message}</p>
      <Button asChild>
        <Link href="/datasets">Go to your datasets</Link>
      </Button>
    </div>
  );
}
