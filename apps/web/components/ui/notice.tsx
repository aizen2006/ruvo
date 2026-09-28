import Link from "next/link";
import { ApiError } from "@/lib/api";

/**
 * A full-width message for a page that cannot show its content: what happened and what to
 * do next. Used for missing runs and an unreachable API.
 */
export function PageNotice({ error, what }: { error: unknown; what: string }) {
  const missing = error instanceof ApiError && error.status === 404;
  const message = missing
    ? `This ${what} does not exist. It may have been deleted, or the link is incomplete.`
    : error instanceof Error
      ? error.message
      : `The ${what} could not be loaded.`;
  return (
    <div className="max-w-xl space-y-3 py-12">
      <h1 className="text-xl font-semibold">{missing ? `${what[0]!.toUpperCase()}${what.slice(1)} not found` : "Something went wrong"}</h1>
      <p className="text-muted">{message}</p>
      <Link href="/runs" className="inline-block text-accent underline-offset-2 hover:underline">
        Go to run history
      </Link>
    </div>
  );
}
