import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium [&_svg]:size-3", {
  variants: {
    variant: {
      neutral: "bg-surface text-muted",
      outline: "border border-border text-muted",
      primary: "bg-[var(--primary-dim)] text-primary",
      gain: "bg-[var(--accent-dim)] text-accent",
      loss: "bg-[var(--red-dim)] text-red",
    },
  },
  defaultVariants: { variant: "neutral" },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
