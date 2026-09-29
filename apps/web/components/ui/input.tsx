import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-control border border-hairline-strong bg-sheet px-3 text-ink transition-colors duration-(--duration-fast) hover:border-graphite focus-visible:border-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-highlighter-wash aria-invalid:border-brick disabled:bg-canvas disabled:text-pencil";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-10 text-small", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "min-h-24 py-2 text-body", className)} {...props} />;
}
