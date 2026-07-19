"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { TickerDividendStats } from "@/lib/analytics";
import { formatMoney, prettyTicker } from "@/lib/analytics";
import { tickerCategoryIndex, UNASSIGNED_COLOR, useAllocation, CATEGORY_COLORS } from "@/lib/allocation";

export const INCOME_COLORS = ["#6d4aff", "#8b5cf6", "#38a6f8", "#22d3ee", "#34d399", "#a78bfa", "#f5a623", "#f472b6", "#60a5fa", "#c4b5fd"];

export default function IncomeDiversification({ divStats, currency }: { divStats: TickerDividendStats[]; currency: string }) {
  const { categories } = useAllocation();
  const [mode, setMode] = useState<"category" | "holding">("category");
  const byCategory = categories.length > 0 && mode === "category";

  const payers = divStats.filter((s) => s.ttm > 0).sort((a, b) => b.ttm - a.ttm);
  const total = payers.reduce((s, p) => s + p.ttm, 0);

  let data: { name: string; fullName: string; value: number; color: string }[];
  if (byCategory) {
    const lookup = tickerCategoryIndex(categories);
    const sums = categories.map(() => 0);
    let unassigned = 0;
    for (const p of payers) {
      const hit = lookup.get(p.ticker);
      if (hit) sums[hit.index] += p.ttm;
      else unassigned += p.ttm;
    }
    data = categories
      .map((c, i) => ({ name: c.name, fullName: `target ${c.targetPct.toFixed(0)}% of portfolio`, value: sums[i], color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))
      .filter((d) => d.value > 0);
    if (unassigned > 0) data.push({ name: "Unassigned", fullName: "payers not in any category", value: unassigned, color: UNASSIGNED_COLOR });
  } else {
    const top = payers.slice(0, 9);
    const restTtm = payers.slice(9).reduce((s, p) => s + p.ttm, 0);
    data = [
      ...top.map((p, i) => ({ name: prettyTicker(p.ticker), fullName: p.name, value: p.ttm, color: INCOME_COLORS[i % INCOME_COLORS.length] })),
      ...(restTtm > 0 ? [{ name: "Other", fullName: `${payers.length - 9} more payers`, value: restTtm, color: INCOME_COLORS[9] }] : []),
    ];
  }

  if (total === 0) return <p className="py-8 text-center text-sm text-muted-2">No dividends received in the last 12 months.</p>;

  return (
    <div>
      {categories.length > 0 && (
        <div className="mb-3 flex w-fit items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
          {(["category", "holding"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${mode === m ? "bg-[var(--primary)] text-white" : "text-muted hover:text-foreground"}`}
            >
              {m === "category" ? "By category" : "By holding"}
            </button>
          ))}
        </div>
      )}
      <div className="grid items-center gap-6 lg:grid-cols-2">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="92%" paddingAngle={2} strokeWidth={0}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)", fontSize: 12 }}
              formatter={(v, name, entry) => [
                `${formatMoney(Number(v), currency)} · ${((Number(v) / total) * 100).toFixed(1)}%`,
                (entry?.payload as { fullName?: string })?.fullName ?? name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-2.5">
        {data.map((d) => {
          const pct = (d.value / total) * 100;
          return (
            <li key={d.name}>
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                <span className="truncate font-medium">{d.name}</span>
                <span className="truncate text-muted-2">{d.fullName}</span>
                <span className="num ml-auto shrink-0 font-medium">{pct.toFixed(1)}%</span>
                <span className="num w-20 shrink-0 text-right text-muted">({formatMoney(d.value, currency, 0)})</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.color }} />
              </div>
            </li>
          );
        })}
      </ul>
      </div>
    </div>
  );
}
