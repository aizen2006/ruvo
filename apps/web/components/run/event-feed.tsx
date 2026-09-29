import type { RunEvent } from "@repo/contracts";
import clsx from "clsx";

const LEVEL = { info: "text-ink", warn: "text-pattern", error: "text-danger" } as const;

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

/** Chronological run log. */
export function EventFeed({ events }: { events: RunEvent[] }) {
  if (events.length === 0) return <p className="py-4 text-sm text-muted">Nothing has happened yet.</p>;
  return (
    <ol className="divide-y divide-rule text-sm">
      {events.map((e) => (
        <li key={e.seq} className="grid grid-cols-[5.5rem_1fr] gap-3 py-2">
          <time className="text-muted" dateTime={e.ts}>
            {time(e.ts)}
          </time>
          <span className={LEVEL[e.level]}>{e.message}</span>
        </li>
      ))}
    </ol>
  );
}

