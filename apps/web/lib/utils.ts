import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our type scale, radii and rhythm names (app/globals.css), so `text-small text-ink` keeps both classes.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "heading", "body", "small", "micro"],
      radius: ["control", "panel", "sheet"],
      spacing: ["section", "stack", "group", "item", "tight"],
      shadow: ["raised"],
    },
  },
});

/** Joins class names and lets later Tailwind classes override earlier ones (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
