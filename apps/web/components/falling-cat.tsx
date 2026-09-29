"use client";

import { useEffect, useRef } from "react";
import { token } from "@/components/dot-field";
import { cn } from "@/lib/utils";

type FallingCatProps = {
  label?: string;
  className?: string;
};

const PIXEL = 1; // CSS px per art pixel, rounded to whole device pixels
const FRAME_MS = 1000 / 30;
const SIZE = 120; // the canvas, art px: the cat plus room for the air rushing past
const CAT = 88; // side of the cat's scratch buffer, art px
const SCALE = 1.25; // art px per unit in the drawing below
const HEAD = { x: 16, y: -1, r: 9, up: -1.1 }; // `up`: where the ears point, radians clockwise from +x

/** A colour token as one ImageData pixel (0xAABBGGRR on little-endian machines). */
function pixel(name: string) {
  const [r, g, b] = token(name).map((c) => Math.round(c * 255)) as [number, number, number];
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** A stroke through the points: straight for two, cubic curves for more. */
const line = (g: CanvasRenderingContext2D, width: number, ...xy: number[]) => {
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(xy[0]!, xy[1]!);
  if (xy.length === 4) g.lineTo(xy[2]!, xy[3]!);
  else for (let i = 2; i < xy.length; i += 6) g.bezierCurveTo(xy[i]!, xy[i + 1]!, xy[i + 2]!, xy[i + 3]!, xy[i + 4]!, xy[i + 5]!);
  g.stroke();
};

/** A point on the head: `r` from its centre, `a` radians clockwise from where the ears point. */
const at = (r: number, a: number) => [HEAD.x + r * Math.cos(HEAD.up + a), HEAD.y + r * Math.sin(HEAD.up + a)] as const;

function dot(g: CanvasRenderingContext2D, r: number, [x, y]: readonly [number, number]) {
  g.beginPath();
  g.arc(x, y, r, 0, 7);
  g.fill();
}

/** The cat on its back, head to the right, as three layers back to front: red legs and tail, green body, blue head. */
function shapes(g: CanvasRenderingContext2D) {
  g.fillStyle = g.strokeStyle = "#f00";
  for (const [x0, y0, x1, y1] of [[-12, 0, -17, -9], [-7, 0, -10, -11], [-2, 0, -2, -11], [2, 0, 4, -10]]) line(g, 5, x0!, y0!, x1!, y1!); // paws up
  line(g, 4, -14, 4, -23, 6, -28, -2, -26, -9, -25, -14, -31, -15, -32, -11); // tail curling up
  g.fillStyle = "#0f0";
  g.beginPath();
  g.ellipse(-4, 2, 13, 7.5, 0, 0, 7);
  g.fill();
  g.fillStyle = "#00f";
  dot(g, HEAD.r, [HEAD.x, HEAD.y]);
  for (const side of [-1, 1]) {
    g.beginPath(); // an ear
    g.moveTo(...at(HEAD.r - 1, side * 0.95));
    g.lineTo(...at(HEAD.r + 5.5, side * 0.55));
    g.lineTo(...at(HEAD.r - 1, side * 0.2));
    g.fill();
  }
}

/** Lines inside the outline: eyes and stripes. */
function marks(g: CanvasRenderingContext2D) {
  g.fillStyle = g.strokeStyle = "#f00";
  for (const side of [-1, 1]) dot(g, 1.6, at(3.4, Math.PI + side * 1.2));
  for (const x of [-11, -6]) line(g, 1, x, 9.5, x + 1, 5.5);
}

/** Paints into the scratch buffer at the cat's pose and returns its pixels. */
function paint(g: CanvasRenderingContext2D, angle: number, draw: (g: CanvasRenderingContext2D) => void) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, CAT, CAT);
  g.fillStyle = "#000"; // opaque, so each channel holds true coverage to threshold
  g.fillRect(0, 0, CAT, CAT);
  g.translate(CAT / 2, CAT / 2);
  g.rotate(angle);
  g.scale(SCALE, SCALE);
  draw(g);
  return g.getImageData(0, 0, CAT, CAT).data;
}

/**
 * A pixel-art cat falling on its back, drawn on whatever is behind it: a loading state. The cat
 * stays centred and sways; thin streaks rushing upward past it make the fall.
 */
export function FallingCat({ label = "Loading", className }: FallingCatProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    g.canvas.width = g.canvas.height = CAT;
    canvas.width = canvas.height = SIZE;
    g.globalCompositeOperation = "lighter"; // layers add up in their own channels
    g.lineCap = g.lineJoin = "round";
    // Art pixels land on whole device pixels.
    const px = Math.max(1, Math.round(PIXEL * devicePixelRatio)) / devicePixelRatio;
    canvas.style.width = canvas.style.height = `${SIZE * px}px`;
    const [ink, streak] = [pixel("ink"), pixel("pencil")];
    const img = ctx.createImageData(SIZE, SIZE);
    // Air streaks: a column, a phase along the fall, a length.
    const streaks = Array.from({ length: 7 }, (_, i) => ({ x: 8 + ((i * 37) % (SIZE - 16)), y: (i * 53) % SIZE, len: 3 + (i % 3) * 2 }));
    const buf = new Uint32Array(img.data.buffer);
    let frame = 0, last = 0;

    const draw = (t: number) => {
      buf.fill(0);
      for (const s of streaks) {
        const y0 = Math.floor((((s.y - 70 * t) % SIZE) + SIZE) % SIZE);
        for (let k = 0; k < s.len; k++) if (y0 + k < SIZE) buf[(y0 + k) * SIZE + s.x] = streak;
      }
      // The cat thresholded to 1-bit, swaying and bobbing: only its outline and inner lines are drawn.
      const angle = 0.35 * Math.sin(t * 0.8) + 0.12 * Math.sin(t * 0.3);
      const ox = (SIZE - CAT) / 2, oy = (SIZE - CAT) / 2 + Math.round(1.5 * Math.sin(t * 1.6));
      const shape = paint(g, angle, shapes), inner = paint(g, angle, marks);
      const on = (p: number, c: number) => shape[p + c]! >= 128;
      for (let i = 0; i < CAT * CAT; i++) {
        const p = i * 4;
        const c = on(p, 2) ? 2 : on(p, 1) ? 1 : on(p, 0) ? 0 : -1; // the frontmost layer here
        if (c < 0) continue;
        const edge = inner[p]! >= 128 || !on(p - 4, c) || !on(p + 4, c) || !on(p - CAT * 4, c) || !on(p + CAT * 4, c);
        // Inside the outline stays clear, but hides any streak passing behind the cat.
        buf[(oy + Math.floor(i / CAT)) * SIZE + ox + (i % CAT)] = edge ? ink : 0;
      }
      ctx.putImageData(img, 0, 0);
    };
    // The browser pauses animation frames in hidden tabs, so no visibility handling is needed.
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now / 1000);
    };

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) draw(0);
    else frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div role="status" className={cn("grid place-items-center", className)}>
      <canvas ref={ref} aria-hidden className="[image-rendering:pixelated]" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
