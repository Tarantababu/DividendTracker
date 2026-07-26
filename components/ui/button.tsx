"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-[var(--primary)] text-[var(--primary-fg)] shadow-xs hover:bg-[var(--primary-hover)]",
        outline: "border border-border bg-card text-foreground hover:bg-card-hover hover:text-foreground",
        subtle: "bg-surface text-muted hover:bg-card-hover hover:text-foreground",
        ghost: "text-muted hover:bg-card-hover hover:text-foreground",
        danger: "bg-[var(--red)] text-white hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3 text-xs [&_svg]:size-4",
        lg: "h-9 px-4 text-sm [&_svg]:size-4",
        icon: "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
