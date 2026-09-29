import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Buttons are ink, not brand colour: the highlighter is kept for what RUVO found or you chose. */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors duration-(--duration-fast) disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-sheet hover:bg-ink/85 disabled:bg-hairline-strong disabled:text-sheet",
        secondary: "border border-hairline-strong bg-sheet text-ink hover:border-ink disabled:text-pencil",
        quiet: "text-graphite hover:bg-ink/5 hover:text-ink disabled:text-pencil",
        danger: "border border-brick/40 bg-sheet text-brick hover:bg-brick-wash disabled:text-pencil",
      },
      size: {
        sm: "h-8 px-3 text-small",
        md: "h-10 px-4 text-small",
        lg: "h-12 px-5 text-body",
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
