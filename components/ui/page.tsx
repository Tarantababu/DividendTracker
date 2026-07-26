import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/** Consistent page shell: one max width, one gutter rhythm across all pages. */
export function Page({ className, children, ...props }: React.ComponentProps<"main">) {
  return (
    <main className={cn("mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8", className)} {...props}>
      {children}
    </main>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {sub && <p className="mt-1 text-xs text-muted sm:text-sm">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Titled content block — the standard section wrapper. */
export function Section({
  title,
  sub,
  actions,
  className,
  children,
}: {
  title?: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardContent>
        {(title || actions) && (
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
              {sub && <p className="mt-0.5 text-xs leading-relaxed text-muted-2">{sub}</p>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Key figure. Label sits above in an eyebrow, the number dominates, context
 * sits underneath — the same hierarchy everywhere so the eye learns it once.
 */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "gain" | "loss" | "primary";
  className?: string;
}) {
  const toneCls =
    tone === "gain" ? "text-accent" : tone === "loss" ? "text-red" : tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <Card className={cn("min-w-0", className)}>
      <div className="p-3.5 sm:p-4">
        <div className="eyebrow truncate">{label}</div>
        <div className={cn("metric mt-1.5 truncate text-xl sm:text-2xl", toneCls)}>{value}</div>
        {sub && <div className="num mt-1 truncate text-xs text-muted-2">{sub}</div>}
      </div>
    </Card>
  );
}

/** Determinate progress bar used by the loading screens. */
export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface", className)} role="progressbar" aria-valuenow={Math.round(value * 100)}>
      <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}
