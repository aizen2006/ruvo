"use client";

import { Globe, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseWebAddress } from "@/lib/url";
import { cn } from "@/lib/utils";

/** Websites the person wants read, plus an inline field to add one. Read-only without `onChange`. */
export function PageList({ urls, onChange, className }: { urls: string[]; onChange?: (urls: string[]) => void; className?: string }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const url = parseWebAddress(value);
    if (!url) return setError("Enter a web address, such as example.com/jobs");
    if (!urls.includes(url)) onChange?.([...urls, url]);
    setValue("");
    setError(null);
    setAdding(false);
  };

  return (
    <div className={cn("space-y-tight", className)}>
      {urls.length > 0 && (
        <ul className="flex flex-wrap gap-tight">
          {urls.map((url) => (
            <li key={url} className={cn("inline-flex max-w-full items-center gap-1 rounded-full bg-ink/6 py-1 pl-3 text-small", onChange ? "pr-1" : "pr-3")}>
              <Globe className="size-3.5 shrink-0 text-graphite" aria-hidden />
              <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
              {onChange && (
                <button
                  type="button"
                  onClick={() => onChange(urls.filter((u) => u !== url))}
                  className="rounded-full p-1 text-graphite hover:bg-ink/10 hover:text-ink"
                  aria-label={`Remove ${url}`}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!onChange ? null : adding ? (
        <div className="space-y-1">
          <div className="flex gap-tight">
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="example.com/jobs"
              aria-label="Website address"
              aria-invalid={Boolean(error)}
            />
            <Button type="button" onClick={add}>
              Add
            </Button>
          </div>
          {error && <p className="text-micro text-brick">{error}</p>}
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-small text-graphite hover:text-ink">
          <Plus className="size-4" /> Add a website to read from
        </button>
      )}
    </div>
  );
}
