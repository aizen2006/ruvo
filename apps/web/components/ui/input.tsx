import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// A 2px ink box; focus adds the ink ring (globals.css) and turns the field highlighter-wash.
const field =
  "w-full rounded-control border-2 border-ink bg-sheet px-3 text-ink transition-colors duration-(--duration-fast) focus-visible:bg-highlighter-wash aria-invalid:border-brick disabled:border-hairline disabled:bg-newsprint disabled:text-pencil";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-10 text-small", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "min-h-24 py-2 text-body", className)} {...props} />;
}
