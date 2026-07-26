import * as React from "react";
import { cn } from "@/lib/utils";

/** The app's one surface. Depth comes from a crisp border, not a heavy shadow. */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border border-border bg-card shadow-xs", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-0.5 p-4 pb-0 sm:p-5 sm:pb-0", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("text-sm font-semibold tracking-tight", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-xs leading-relaxed text-muted-2", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-4 sm:p-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center gap-2 p-4 pt-0 sm:p-5 sm:pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
