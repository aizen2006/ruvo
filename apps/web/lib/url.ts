/** A web address typed by a person, as an absolute http(s) URL ("example.com/jobs" gets https://), or null. */
export function parseWebAddress(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.hostname.includes(".") || url.hostname === "localhost" ? url.href : null;
  } catch {
    return null;
  }
}

/** The request text sent to RUVO: the person's words plus the pages they added, one line. */
export const withPages = (prompt: string, urls: string[]) => (urls.length ? `${prompt.trim()}\n\nRead from: ${urls.join(" ")}` : prompt.trim());
