import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Small labels and chips. Meaning colours always come with words, never colour alone. */
export const badgeVariants = cva("inline-flex items-center gap-1 px-2 py-0.5 text-micro font-bold whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "bg-newsprint text-ink",
      outline: "border-2 border-ink text-ink",
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
