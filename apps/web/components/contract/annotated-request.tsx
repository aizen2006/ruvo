"use client";

import type { Assumption } from "@repo/contracts";
import clsx from "clsx";
import { Fragment, useState } from "react";

type Segment = { text: string; note: number | null };

/** Splits the prompt into plain text and the phrases each assumption interprets (first match, no overlaps). */
function segment(prompt: string, assumptions: Assumption[]): { segments: Segment[]; anchored: Set<number> } {
  const lower = prompt.toLowerCase();
  const spans = assumptions
    .map((a, note) => ({ note, start: lower.indexOf(a.phrase.toLowerCase().trim()), length: a.phrase.trim().length }))
    .filter((s) => s.start >= 0 && s.length > 0)
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  const anchored = new Set<number>();
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    if (span.start > cursor) segments.push({ text: prompt.slice(cursor, span.start), note: null });
    segments.push({ text: prompt.slice(span.start, span.start + span.length), note: span.note });
    anchored.add(span.note);
    cursor = span.start + span.length;
  }
  if (cursor < prompt.length) segments.push({ text: prompt.slice(cursor), note: null });
  return { segments, anchored };
}

/**
 * The request as the user wrote it, with every phrase RUVO had to interpret underlined
 * and the interpretation written in the margin, like an editor's annotations.
 */
export function AnnotatedRequest({ prompt, assumptions }: { prompt: string; assumptions: Assumption[] }) {
  const [focus, setFocus] = useState<number | null>(null);
  const { segments, anchored } = segment(prompt, assumptions);
  const unanchored = assumptions.map((a, i) => ({ a, i })).filter(({ i }) => !anchored.has(i));
  const markerOf = (note: number) => [...anchored].sort((x, y) => x - y).indexOf(note) + 1;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <p className="text-heading sm:text-title">
        {segments.map((s, i) =>
          s.note === null ? (
            <Fragment key={i}>{s.text}</Fragment>
          ) : (
            <mark
              key={i}
              onMouseEnter={() => setFocus(s.note)}
              onMouseLeave={() => setFocus(null)}
              className={clsx(
                "cursor-default bg-transparent text-inherit underline decoration-2 underline-offset-[6px] transition-colors",
                focus === s.note ? "decoration-ink bg-highlighter-wash" : "decoration-ink/40",
              )}
            >
              {s.text}
              <sup className="ml-0.5 font-sans text-micro text-ink">{markerOf(s.note)}</sup>
            </mark>
          ),
        )}
      </p>

      <ol className="space-y-4 border-l border-hairline pl-5 text-small">
        {assumptions.map((a, i) =>
          anchored.has(i) ? (
            <li
              key={i}
              onMouseEnter={() => setFocus(i)}
              onMouseLeave={() => setFocus(null)}
              className={clsx("space-y-1 transition-colors", focus !== null && focus !== i && "opacity-50")}
            >
              <p>
                <span className="mr-2 text-ink">{markerOf(i)}</span>
                <span className="italic">“{a.phrase}”</span>
              </p>
              <p className="text-ink">{a.interpretation}</p>
              {a.signals.length > 0 && <p className="text-graphite">Checked using: {a.signals.join("; ")}</p>}
            </li>
          ) : null,
        )}
        {unanchored.length > 0 && (
          <li className="space-y-2 pt-1">
            <p className="text-graphite">Also assumed</p>
            {unanchored.map(({ a, i }) => (
              <p key={i}>
                <span className="italic">“{a.phrase}”</span>: {a.interpretation}
              </p>
            ))}
          </li>
        )}
      </ol>
    </div>
  );
}
