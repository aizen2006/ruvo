"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DotField } from "@/components/dot-field";
import { cn } from "@/lib/utils";

const TOTAL_ROWS = 214;
/** What RUVO is doing at each stretch of the scroll, in the collecting screen's own words. */
const STEPS = [
  { at: 0, label: "Searching the web" },
  { at: 0.25, label: "Reading job boards and pages" },
  { at: 0.5, label: "Checking values against their pages" },
  { at: 0.75, label: "Scoring the leads" },
  { at: 0.97, label: "Ready" },
];

/**
 * Step 3 of the landing sequence, the collecting screen as a scroll: the band pins while you
 * scroll through it, and the cloud settles into rows as the count climbs. Scroll stands in for time.
 */
export function CollectingBand({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = ref.current!.getBoundingClientRect();
      setProgress(Math.min(1, Math.max(0, -box.top / (box.height - innerHeight))));
    };
    const schedule = () => (frame ||= requestAnimationFrame(measure));
    measure();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
    };
  }, []);

  const rows = Math.round(progress * TOTAL_ROWS);
  const current = STEPS.filter((s) => progress >= s.at).length - 1;

  return (
    <li ref={ref} className="relative h-[220svh] bg-void text-sheet">
      <div className="sticky top-0 flex h-svh flex-col overflow-hidden">
        {/* Clear on the left for reading; the cloud bleeds off the right edge. */}
        <DotField tone="void" intensity={1} resolve={progress} className="absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent_30%,black_75%)] md:[mask-image:linear-gradient(to_right,transparent_25%,black_65%)]" />
        <div className="relative mx-auto flex w-full max-w-[1200px] flex-1 flex-col justify-center gap-stack px-4 py-section sm:px-6">
          {children}
          <div className="space-y-group">
            <p className="flex items-baseline gap-item">
              <span className="font-dot text-count font-black tabular">{rows}</span>
              <span className="text-heading">leads so far</span>
            </p>
            <ol className="space-y-tight font-mono text-small">
              {STEPS.map((step, i) => {
                const done = i < current || (i === current && i === STEPS.length - 1);
                return (
                  <li key={step.label} className={cn("flex items-center gap-tight", i <= current ? "text-sheet" : "text-sheet/60")}>
                    {/* Signal when done, paper while in progress, dim for what's next. */}
                    <span aria-hidden className={cn("size-1.5", done ? "bg-highlighter" : i === current ? "bg-sheet" : "bg-sheet/30")} />
                    {step.label}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </li>
  );
}
