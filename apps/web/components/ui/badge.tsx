import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Small labels and chips. Meaning colours always come with words, never colour alone. */
export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-micro font-medium whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "bg-ink/6 text-graphite",
      outline: "border border-hairline-strong text-graphite",
      sure: "bg-stamp-wash text-stamp",
      check: "bg-amber-wash text-amber",
      error: "bg-brick-wash text-brick",
      chosen: "bg-highlighter text-ink",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
