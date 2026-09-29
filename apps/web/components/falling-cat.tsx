"use client";

import { useEffect, useRef } from "react";
import { token } from "@/components/dot-field";
import { cn } from "@/lib/utils";

type FallingCatProps = {
  label?: string;
  className?: string;
};

type Star = { x: number; y: number; speed: number; arm: number; tall: boolean; twinkle: number; signal: boolean };

const PIXEL = 3; // CSS px per art pixel
const FRAME_MS = 1000 / 24;
const CAT = 88; // side of the cat's scratch buffer, art px
const SCALE = 1.25; // art px per unit in the drawing below
const HEAD = { x: 16, y: -1, r: 9, up: -1.1 }; // `up`: where the ears point, radians clockwise from +x

/** A colour token as one ImageData pixel (0xAABBGGRR on little-endian machines). */
function pixel(name: string) {
  const [r, g, b] = token(name).map((c) => Math.round(c * 255)) as [number, number, number];
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** Two layers of dots and plus sparkles; the near one is faster and sparklier. */
function scatter(w: number, h: number): Star[] {
  return Array.from({ length: Math.round((w * h) / 220) }, (_, i) => {
    const near = i % 3 === 0;
    const r = Math.random();
    return {
      x: Math.floor(Math.random() * w),
      y: Math.random() * (h + 8),
      speed: near ? 7 : 3,
      arm: near ? (r < 0.12 ? 2 : r < 0.45 ? 1 : 0) : r < 0.08 ? 1 : 0,
      tall: r < 0.06,
      twinkle: Math.random() < 0.3 ? Math.random() * 7 : -1,
      signal: Math.random() < 1 / 40,
    };
  });
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

/** A pixel-art cat tumbling on its back through a starfield streaming upward: a loading state. */
export function FallingCat({ label = "Loading", className }: FallingCatProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const box = canvas.parentElement!;
    const ctx = canvas.getContext("2d")!;
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    g.canvas.width = g.canvas.height = CAT;
    g.globalCompositeOperation = "lighter"; // layers add up in their own channels
    g.lineCap = g.lineJoin = "round";
    const [black, paper, signal] = ["void", "canvas", "highlighter"].map(pixel) as [number, number, number];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, img: ImageData, buf: Uint32Array, stars: Star[] = [];
    let frame = 0, last = 0, onScreen = true;

    const put = (x: number, y: number, c: number) => {
      if (x >= 0 && x < w && y >= 0 && y < h) buf[y * w + x] = c;
    };
    const draw = (t: number) => {
      buf.fill(black);
      for (const s of stars) {
        const y = Math.floor((((s.y - s.speed * t) % (h + 8)) + h + 8) % (h + 8)) - 4;
        const arm = s.twinkle >= 0 && Math.sin(t * 2 + s.twinkle) < -0.2 ? s.arm - 1 : s.arm;
        const c = s.signal ? signal : paper;
        if (arm >= 0) put(s.x, y, c);
        for (let k = 1; k <= arm; k++) put(s.x - k, y, c), put(s.x + k, y, c);
        for (let k = 1; k <= arm + (s.tall && arm > 0 ? 1 : 0); k++) put(s.x, y - k, c), put(s.x, y + k, c);
      }
      // The cat, thresholded to 1-bit: its outline and inner lines in paper, the rest blacks out the stars.
      const angle = 0.35 * Math.sin(t * 0.8) + 0.12 * Math.sin(t * 0.3);
      const shape = paint(g, angle, shapes), inner = paint(g, angle, marks);
      const on = (p: number, c: number) => shape[p + c]! >= 128;
      const ox = Math.round((w - CAT) / 2 + Math.sin(t * 0.5)), oy = Math.round((h - CAT) / 2 + 1.5 * Math.sin(t * 1.6));
      for (let i = 0; i < CAT * CAT; i++) {
        const p = i * 4;
        const c = on(p, 2) ? 2 : on(p, 1) ? 1 : on(p, 0) ? 0 : -1; // the frontmost layer here
        if (c < 0) continue;
        const edge = inner[p]! >= 128 || !on(p - 4, c) || !on(p + 4, c) || !on(p - CAT * 4, c) || !on(p + CAT * 4, c);
        put(ox + (i % CAT), oy + Math.floor(i / CAT), edge ? paper : black);
      }
      ctx.putImageData(img, 0, 0);
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < FRAME_MS || !w) return;
      last = now;
      draw(now / 1000);
    };
    // Animate only while visible; otherwise the last frame stays on screen.
    const sync = () => {
      cancelAnimationFrame(frame);
      if (!still && onScreen && !document.hidden) frame = requestAnimationFrame(loop);
    };

    const resize = new ResizeObserver(() => {
      // Art pixels land on whole device pixels.
      const px = Math.round(PIXEL * devicePixelRatio) / devicePixelRatio;
      w = canvas.width = Math.ceil(box.clientWidth / px);
      h = canvas.height = Math.ceil(box.clientHeight / px);
      canvas.style.width = `${w * px}px`;
      canvas.style.height = `${h * px}px`;
      img = ctx.createImageData(w, h);
      buf = new Uint32Array(img.data.buffer);
      stars = scatter(w, h);
      draw(still ? 0 : performance.now() / 1000);
    });
    const visible = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      sync();
    });
    resize.observe(box);
    visible.observe(box);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visible.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div role="status" className={cn("relative overflow-hidden bg-void", className)}>
      <canvas ref={ref} aria-hidden className="absolute top-0 left-0 [image-rendering:pixelated]" />
      <p className="absolute top-[calc(50%+96px)] left-1/2 -translate-x-1/2 bg-void px-tight font-mono text-micro text-canvas">{label}</p>
    </div>
  );
}
