import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "quiet" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong disabled:bg-faint",
  secondary: "border border-rule-strong bg-surface text-ink hover:border-ink disabled:text-faint",
  quiet: "text-muted hover:text-ink hover:bg-accent-wash disabled:text-faint",
  danger: "border border-danger/40 text-danger hover:bg-danger-wash disabled:text-faint",
};

export function Button({ variant = "secondary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center gap-2 rounded-(--radius-control) px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
