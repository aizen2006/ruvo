import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Square ink blocks. Hovering an enabled button marks it in highlighter, the colour for what you
 * choose; disabled buttons go flat grey.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap transition-colors duration-(--duration-fast) disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border-2 border-ink bg-ink text-sheet enabled:hover:bg-highlighter enabled:hover:text-ink aria-expanded:bg-highlighter aria-expanded:text-ink disabled:border-newsprint disabled:bg-newsprint disabled:text-pencil",
        secondary: "border-2 border-ink bg-sheet text-ink enabled:hover:bg-highlighter disabled:border-hairline disabled:text-pencil",
        quiet: "text-ink underline decoration-2 underline-offset-4 enabled:hover:bg-highlighter disabled:text-pencil disabled:no-underline",
        danger: "border-2 border-brick bg-sheet text-brick enabled:hover:bg-brick enabled:hover:text-sheet disabled:border-hairline disabled:text-pencil",
      },
      size: {
        sm: "h-8 px-3 text-small",
        md: "h-10 px-4 text-small",
        lg: "h-14 px-6 text-body",
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
