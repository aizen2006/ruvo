import { cn } from "@/lib/utils";

/** The cat, one character per pixel: tail up, ears up, eyes left open. */
const SPRITE = [
  "......###....................",
  "......###....................",
  "......####...................",
  "......####....###............",
  "......####...#####.....###...",
  "......####...#####....####...",
  "......#####.##############...",
  "......#####.##############...",
  "......#####.##############...",
  "......#####.##############...",
  "......####################...",
  ".....#############.####.###..",
  "....##############.####.###..",
  "....##############.####.###..",
  "...########################..",
  "...########################..",
  "..#########################..",
  "..#########################..",
  "..########################...",
  "..#######################....",
  ".#########################...",
  ".#########################...",
  ".##########################..",
  "######.####################..",
  "#####....###################.",
  "#####.....#########...######.",
  "####......######.......######",
  "####......######........#####",
  ".##.......#####...........##.",
  "..........#####..............",
  "..........#####..............",
  "...........###...............",
];

/** Every run of pixels in a row as one path segment, so the sprite is a single crisp shape. */
const PATH = SPRITE.flatMap((row, y) => [...row.matchAll(/#+/g)].map((run) => `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`)).join("");

/** Air rushing past: a column (px from the cat's centre), a length and a start delay. */
const STREAKS = [
  { x: -34, h: 10, delay: 0 },
  { x: -20, h: 6, delay: 0.5 },
  { x: 24, h: 12, delay: 0.25 },
  { x: 38, h: 6, delay: 0.8 },
  { x: 4, h: 8, delay: 1.1 },
];

/**
 * A small pixel cat falling, centred: a loading state. The cat stays in place, swaying as it
 * drops, while thin streaks rush upward past it.
 */
export function FallingCat({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("grid place-items-center", className)}>
      <div aria-hidden className="relative">
        {STREAKS.map((s) => (
          <span
            key={s.x}
            className="absolute top-1/2 left-1/2 w-px bg-pencil opacity-0 motion-safe:animate-streak"
            style={{ height: s.h, marginLeft: s.x, animationDelay: `${s.delay}s` }}
          />
        ))}
        <svg viewBox="0 0 29 32" shapeRendering="crispEdges" className="relative h-16 w-[58px] fill-ink motion-safe:animate-cat-fall">
          <path d={PATH} />
        </svg>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
