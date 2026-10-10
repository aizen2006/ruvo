import type { RunContext } from "../../core/run";

/** What a request expects back; a response of another content type is refused. */
export type Expect = "json" | "html" | "text";

/** A request as a transport sees it, after the fetcher's checks. */
export interface TransportRequest {
  url: string;
  expect: Expect;
  maxBytes?: number;
  /** HEAD reads a file's headers, whatever its type; `expect` is not checked. */
  method?: "GET" | "HEAD";
}

/** The slice of a run a transport uses: cancellation, request counters, and the run a paid read is charged to. */
export type TransportScope = Pick<RunContext, "signal" | "metrics"> & Partial<Pick<RunContext, "runId">>;

/** A response as fetched; `challenge` marks a bot check, which is never stored. A HEAD's has its `headers` (lower-case names). */
export type Fetched = { finalUrl: string; status: number; contentType: string | null; body: string; challenge?: boolean; headers?: Record<string, string> };

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export const ACCEPT: Record<Expect, string> = {
  json: "application/json",
  html: "text/html,application/xhtml+xml",
  text: "text/*",
};

export function acceptsContentType(expect: Expect, contentType: string | null): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (expect === "json") return type.includes("json") || type.startsWith("text/");
  if (expect === "html") return type.includes("html") || type === "";
  return type.startsWith("text/") || type.includes("json") || type.includes("xml");
}
