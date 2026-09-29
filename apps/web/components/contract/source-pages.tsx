"use client";

import { useState } from "react";
import { Button } from "../ui/button";

/**
 * The list pages RUVO reads for this request. Jobs can also come from the company registry;
 * any other kind of data comes only from pages listed here, so an empty list is a call to act.
 */
export function SourcePages({
  urls,
  needed,
  onChange,
}: {
  urls: string[];
  /** True when the request cannot be collected without a page (non-job data). */
  needed: boolean;
  /** Present only while the contract is editable. */
  onChange?: (urls: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const raw = value.trim();
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!urls.includes(url.href)) onChange?.([...urls, url.href]);
      setValue("");
      setError(null);
    } catch {
      setError("Enter a web address, such as https://example.com/jobs");
    }
  };

  if (urls.length === 0 && !needed && !onChange) return null;

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-body font-semibold">Pages to read</h2>
        <p className="text-small text-graphite">
          {needed
            ? "RUVO reads these records from list pages you link. It records how to read each page, so later runs repeat it without AI."
            : "List pages to read alongside the job boards RUVO already knows."}
        </p>
      </header>

      {urls.length > 0 ? (
        <ul className="divide-y divide-hairline border-y border-hairline text-small">
          {urls.map((url) => (
            <li key={url} className="flex items-center justify-between gap-3 py-2">
              <a href={url} target="_blank" rel="noreferrer" className="truncate font-mono text-small text-ink hover:underline">
                {url}
              </a>
              {onChange && (
                <Button variant="quiet" className="px-2 py-1" onClick={() => onChange(urls.filter((u) => u !== url))}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        needed && (
          <p className="rounded-control bg-pattern-wash px-3 py-2 text-small text-pattern">
            Add the address of a page that lists these records. Nothing can be collected until there is one.
          </p>
        )
      )}

      {onChange && (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="sr-only" htmlFor="source-page">
            Page address
          </label>
          <input
            id="source-page"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://example.com/listings"
            className="min-w-0 flex-1 rounded-control border border-hairline-strong bg-sheet px-3 py-2 font-mono text-small outline-none focus:border-ink"
          />
          <Button type="submit" disabled={!value.trim()}>
            Add page
          </Button>
          {error && <p className="w-full text-small text-brick">{error}</p>}
        </form>
      )}
    </section>
  );
}
