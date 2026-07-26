import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "positive" | "negative" | "accent" | "primary";
}

const toneClass: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-accent",
  negative: "text-red",
  accent: "text-blue",
  primary: "text-primary",
};

/**
 * Key figure. One hierarchy used everywhere: eyebrow label, dominant tabular
 * number, quiet context line. Depth comes from the border, not a shadow.
 */
export default function StatCard({ label, value, sub, tone = "default" }: StatCardProps) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3.5 shadow-xs transition-colors hover:border-border-strong sm:px-5 sm:py-4">
      <div className="eyebrow truncate">{label}</div>
      <div className={cn("metric mt-1.5 truncate text-xl sm:text-2xl", toneClass[tone])}>{value}</div>
      {sub && <div className="num mt-1 truncate text-xs text-muted-2">{sub}</div>}
    </div>
  );
}
