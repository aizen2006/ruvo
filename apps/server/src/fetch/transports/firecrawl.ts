import { recordScrape } from "../../search/cache";
import type { FirecrawlClient } from "../../search/firecrawl";
import { FetchError } from "../errors";
import { hasChallengeMarkers } from "../sufficiency";
import { DEFAULT_MAX_BYTES, type Fetched, type TransportRequest, type TransportScope } from "./types";

/** One page read through Firecrawl's scrape, as rendered HTML. Its credits are recorded with the searches, so the run's cost counts them. */
export function createFirecrawlTransport({ client, usdPerCredit }: { client: FirecrawlClient; usdPerCredit: number }) {
  return async (scope: TransportScope, req: TransportRequest): Promise<Fetched> => {
    const { document, creditsUsed } = await client.scrape(req.url, { formats: ["rawHtml"], onlyMainContent: false, signal: scope.signal });
    await recordScrape(scope.runId, req.url, creditsUsed, creditsUsed * usdPerCredit);
    const finalUrl = document.metadata?.url ?? req.url;
    const status = document.metadata?.statusCode ?? 200;
    const body = document.rawHtml ?? "";
    const challenge = hasChallengeMarkers(body);
    if (status >= 400 || challenge) {
      throw new FetchError("http_status", `Firecrawl could not read ${finalUrl} (HTTP ${status}${challenge ? ", a bot check" : ""})`, { url: finalUrl, status, challenge });
    }
    const maxBytes = req.maxBytes ?? DEFAULT_MAX_BYTES;
    if (Buffer.byteLength(body) > maxBytes) throw new FetchError("too_large", `Response from ${finalUrl} exceeds ${maxBytes} bytes`, { url: finalUrl });
    return { finalUrl, status, contentType: "text/html", body };
  };
}
