"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import type { TickerDividendStats } from "@/lib/analytics";
import { formatMoney, formatPct, prettyTicker } from "@/lib/analytics";

export default function YieldPayoutChart({ divStats, currency }: { divStats: TickerDividendStats[]; currency: string }) {
  const data = divStats
    .filter((s) => s.currentValue > 0 && (s.yieldOnValue ?? 0) > 0)
    .sort((a, b) => (b.yieldOnValue ?? 0) - (a.yieldOnValue ?? 0))
    .map((s) => ({
      name: prettyTicker(s.ticker),
      fullName: s.name,
      yieldPct: (s.yieldOnValue ?? 0) * 100,
      yocPct: (s.yieldOnCost ?? 0) * 100,
      ttm: s.ttm,
    }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border-soft)" />
          <XAxis dataKey="name" tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={data.length > 10 ? -35 : 0} textAnchor={data.length > 10 ? "end" : "middle"} height={data.length > 10 ? 50 : 30} />
          <YAxis tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={tooltipStyle}
            formatter={(v, name) => [
              name === "yieldPct" ? formatPct(Number(v) / 100) : formatMoney(Number(v), currency),
              name === "yieldPct" ? "Yield (ttm)" : "Dividends 12m",
            ]}
            labelFormatter={(label, payload) => (payload?.[0]?.payload as { fullName?: string })?.fullName ?? String(label)}
          />
          <Bar dataKey="yieldPct" radius={[5, 5, 0, 0]} maxBarSize={40}>
            {data.map((_, i) => (
              <Cell key={i} fill="var(--primary)" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
