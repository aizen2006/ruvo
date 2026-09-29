import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Buttons are ink, not signal: the signal is kept for what RUVO found or you chose. Labels are mono. */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-mono font-medium whitespace-nowrap transition-colors duration-(--duration-fast) select-none disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // A faint top highlight keeps the black face in the same family as the bevel.
        primary:
          "bg-ink text-sheet shadow-[inset_0_1px_0_rgb(255_255_255/0.22)] hover:bg-graphite active:bg-ink active:shadow-none disabled:bg-hairline-strong disabled:shadow-none",
        secondary: "bevel text-ink hover:bg-white disabled:bg-sheet disabled:text-pencil",
        quiet: "text-graphite hover:bg-ink/6 hover:text-ink active:bg-ink/10 disabled:bg-transparent disabled:text-pencil",
        danger: "bevel text-brick hover:bg-brick-wash disabled:bg-sheet disabled:text-pencil",
      },
      size: {
        sm: "h-8 px-3 text-micro",
        md: "h-10 px-4 text-small",
        lg: "h-12 px-5 text-small",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ variant, size, asChild, className, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
