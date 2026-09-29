import type { RunEvent } from "@repo/contracts";
import clsx from "clsx";

const LEVEL = { info: "text-ink", warn: "text-pattern", error: "text-brick" } as const;

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

/** Chronological run log. */
export function EventFeed({ events }: { events: RunEvent[] }) {
  if (events.length === 0) return <p className="py-4 text-small text-graphite">Nothing has happened yet.</p>;
  return (
    <ol className="divide-y divide-hairline text-small">
      {events.map((e) => (
        <li key={e.seq} className="grid grid-cols-[5.5rem_1fr] gap-3 py-2">
          <time className="font-mono text-graphite tabular" dateTime={e.ts}>
            {time(e.ts)}
          </time>
          <span className={LEVEL[e.level]}>{e.message}</span>
        </li>
      ))}
    </ol>
  );
}

