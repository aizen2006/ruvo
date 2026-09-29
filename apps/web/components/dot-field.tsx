"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type DotFieldProps = {
  /** `ink`: black marks on paper. `void`: paper marks on black. */
  tone?: "ink" | "void";
  /** Density and contrast, 0–1: low for the ambient backdrop, 1 for the big moments. */
  intensity?: number;
  /** 0 is drifting cloud, 1 is settled into scanlines, the look of rows. Changes glide. */
  resolve?: number;
  /** A mouse lens that reads the field into rows around the pointer. */
  interactive?: boolean;
  className?: string;
};

const CELL = 7; // grid pitch, CSS px
const FRAME_MS = 1000 / 30; // ~30fps is plenty for a slow drift
const EASE = 0.12; // share of the way to the target each frame (resolve, lens)

const VERTEX = "attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }";

// GLSL ES 1.00 so the same source runs on WebGL2 and WebGL1. Coordinates are CSS px unless noted.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uTime, uDpr, uCell, uResolve, uIntensity;
uniform vec3 uLens;   // pointer x, y and strength 0–1
uniform vec3 uMark, uSignal;
uniform vec4 uBack;   // premultiplied background

float hash(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

// Soft cumulus: wide, gently warped fbm cut into billows with soft edges, drifting right.
float cloud(vec2 p) {
  p = p / vec2(270.0, 170.0) - vec2(uTime * 0.015, 0.0);
  p += 0.45 * vec2(noise(p + uTime * 0.02), noise(p + 7.3 - uTime * 0.02));
  return smoothstep(0.47, 0.72, fbm(p));
}

// 8×8 Bayer threshold built from 2×2 steps (no bit ops in GLSL ES 1.00).
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer8(vec2 a) { return bayer2(a * 0.25) * 0.0625 + bayer2(a * 0.5) * 0.25 + bayer2(a) + 0.0078; }

void main() {
  vec2 px = floor(gl_FragCoord.xy);                  // device px
  vec2 cell = floor(px / uCell);
  vec2 d = px - cell * uCell - floor(uCell * 0.5);   // offset from the cell's centre pixel
  vec2 centre = (cell + 0.5) * uCell / uDpr;
  float density = mix(0.4, 1.0, uIntensity);

  // How resolved this cell is: the global resolve plus the pointer lens, dissolving cell by cell.
  float lens = uLens.z * smoothstep(160.0, 40.0, distance(centre, uLens.xy));
  float r = clamp(uResolve + lens, 0.0, 1.0);
  float ink, spark = 0.0;
  if (r > hash(cell + 3.7) * 0.98 + 0.01) {
    // A scanline through the cell, continuous across cells, thicker where the cloud is dense.
    float w = cloud(vec2(px.x / uDpr, centre.y)) * density;
    ink = step(0.08, w) * step(abs(d.y), max(w * uCell * 0.36, 0.0));
  } else {
    // A plus mark where the dithered cloud is on; a rare few glow in the signal colour.
    float on = step(bayer8(cell), cloud(centre) * density);
    vec2 a = abs(d);
    ink = on * step(min(a.x, a.y), floor(uDpr * 0.5)) * step(max(a.x, a.y), floor(uCell * 0.3));
    float h = hash(cell + 11.0);
    spark = step(h, 0.006) * step(0.3, sin(uTime * 1.3 + h * 5000.0));
  }
  vec4 mark = vec4(mix(uMark, uSignal, spark), 1.0) * ink * mix(0.25 + 0.3 * spark, 1.0, uIntensity);
  gl_FragColor = mark + uBack * (1.0 - mark.a);
}`;

/** A colour token from globals.css as 0–1 RGB. Tokens are hex; the production build may shorten them. */
function token(name: string) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim().slice(1);
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, "$&$&") : hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number];
}

function link(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, "a");
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn("DotField:", gl.getProgramInfoLog(program));
  return null;
}

/**
 * The signature backdrop: cumulus noise, ordered-dithered into plus marks, that resolves into
 * scanlines. Size it with `className`; it fills its box. Renders nothing without WebGL.
 */
export function DotField({ tone = "ink", intensity = 1, resolve = 0, interactive = false, className }: DotFieldProps) {
  const ref = useRef<HTMLDivElement>(null);
  const props = useRef({ tone, intensity, resolve, interactive });
  const redraw = useRef<() => void>(null);

  useEffect(() => {
    props.current = { tone, intensity, resolve, interactive };
    redraw.current?.();
  }, [tone, intensity, resolve, interactive]);

  useEffect(() => {
    const box = ref.current!;
    // A fresh canvas per mount, so a lost context (cleanup, Strict Mode) is never reused.
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 block size-full";
    const options = { alpha: true, antialias: false, depth: false, powerPreference: "low-power" } as const;
    const gl = (canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options)) as WebGLRenderingContext | null;
    const program = gl && link(gl);
    if (!gl || !program) return;
    box.append(canvas);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one full-screen triangle
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const [uTime, uDpr, uCell, uResolve, uIntensity, uLens, uMark, uSignal, uBack] = ["uTime", "uDpr", "uCell", "uResolve", "uIntensity", "uLens", "uMark", "uSignal", "uBack"].map(u);
    const ink = token("ink");
    const paper = token("canvas");
    gl.uniform3fv(uSignal!, token("highlighter"));

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const eased = { resolve: props.current.resolve, lens: 0, x: 0, y: 0 };
    let pointer: { x: number; y: number } | null = null; // client px
    let dpr = 1;
    let frame = 0;
    let last = 0;
    let onScreen = true;

    const draw = (now: number) => {
      const { tone, intensity, resolve, interactive } = props.current;
      const k = still ? 1 : EASE;
      const rect = box.getBoundingClientRect();
      const aim = interactive && pointer && !still ? { x: pointer.x - rect.left, y: rect.bottom - pointer.y } : null;
      if (aim && eased.lens < 0.01) Object.assign(eased, aim); // appear at the pointer rather than slide in
      if (aim) {
        eased.x += (aim.x - eased.x) * k;
        eased.y += (aim.y - eased.y) * k;
      }
      eased.lens += ((aim ? 1 : 0) - eased.lens) * k;
      eased.resolve += (resolve - eased.resolve) * k;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uTime!, still ? 40 : now / 1000);
      gl.uniform1f(uDpr!, dpr);
      gl.uniform1f(uCell!, Math.round(CELL * dpr));
      gl.uniform1f(uResolve!, eased.resolve);
      gl.uniform1f(uIntensity!, intensity);
      gl.uniform3f(uLens!, eased.x, eased.y, eased.lens);
      gl.uniform3fv(uMark!, tone === "ink" ? ink : paper);
      gl.uniform4fv(uBack!, tone === "ink" ? [0, 0, 0, 0] : [...ink, 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now);
    };
    // Animate only while visible; otherwise the last frame stays on screen.
    const sync = () => {
      cancelAnimationFrame(frame);
      if (!still && onScreen && !document.hidden) frame = requestAnimationFrame(loop);
    };
    redraw.current = () => draw(performance.now());

    const resize = new ResizeObserver(() => {
      dpr = Math.min(devicePixelRatio, 2);
      canvas.width = Math.round(box.clientWidth * dpr);
      canvas.height = Math.round(box.clientHeight * dpr);
      draw(performance.now());
    });
    const visible = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      sync();
    });
    const move = (e: PointerEvent) => {
      pointer = e.pointerType === "touch" ? null : { x: e.clientX, y: e.clientY };
    };
    const leave = () => (pointer = null);
    resize.observe(box);
    visible.observe(box);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    sync();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visible.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      redraw.current = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, []);

  return <div ref={ref} aria-hidden className={cn("relative overflow-hidden", className)} />;
}
