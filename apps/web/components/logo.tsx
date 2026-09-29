import Link from "next/link";

// The mark is a 6×5 pixel grid on a 4px pitch.
const PITCH = 4;
const COLS = 6;
const ROWS = 5;
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
/** The one pixel that's "found": it takes the signal colour. */
const FOUND = { x: 5, y: 2 };

/**
 * Each pixel's two states: an ordered-dither ramp (sparse left, dense right, like the dot
 * field) at rest, and three dotted rows once resolved.
 */
const PIXELS = Array.from({ length: COLS * ROWS }, (_, i) => {
  const x = i % COLS;
  const y = Math.floor(i / COLS);
  return { x, y, noise: BAYER[y % 4]![x % 4]! < ((x + 1) / COLS) * 15, row: y % 2 === 0 };
}).filter((p) => p.noise || p.row);

/** RUVO's wordmark: dithered noise that resolves into rows on hover or focus, then the name in dot-matrix. */
export function Logo() {
  return (
    <Link href="/" aria-label="RUVO home" className="group flex items-center gap-2.5">
      <svg aria-hidden viewBox={`0 0 ${COLS * PITCH - 1} ${ROWS * PITCH - 1}`} shapeRendering="crispEdges" className="h-[19px] w-[23px]">
        {PIXELS.map(({ x, y, noise, row }) => (
          <rect
            key={`${x}-${y}`}
            x={x * PITCH}
            y={y * PITCH}
            width="3"
            height="3"
            className={[
              x === FOUND.x && y === FOUND.y ? "fill-highlighter" : "fill-ink",
              noise ? "opacity-100" : "opacity-0",
              row ? "group-hover:opacity-100 group-focus-visible:opacity-100" : "group-hover:opacity-0 group-focus-visible:opacity-0",
              "motion-safe:transition-opacity motion-safe:duration-200",
            ].join(" ")}
            style={{ transitionDelay: `${x * 30}ms` }}
          />
        ))}
      </svg>
      <span className="font-dot text-[2rem] leading-none font-black">ruvo</span>
    </Link>
  );
}
