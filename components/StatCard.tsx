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

export default function StatCard({ label, value, sub, tone = "default" }: StatCardProps) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">{label}</div>
      <div className={`num mt-1.5 text-xl font-semibold sm:text-2xl ${toneClass[tone]}`}>{value}</div>
      {sub && <div className="num mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
