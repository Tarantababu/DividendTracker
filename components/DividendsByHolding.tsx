"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import type { TickerDividendStats } from "@/lib/analytics";
import { formatMoney, prettyTicker } from "@/lib/analytics";

export default function DividendsByHolding({ divStats, currency }: { divStats: TickerDividendStats[]; currency: string }) {
  const data = divStats
    .filter((s) => s.allTime > 0)
    .sort((a, b) => b.allTime - a.allTime)
    .slice(0, 12)
    .map((s) => ({ name: prettyTicker(s.ticker), fullName: s.name, allTime: s.allTime, ttm: s.ttm }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border-soft)" />
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--muted-2)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={data.length > 8 ? -35 : 0}
            textAnchor={data.length > 8 ? "end" : "middle"}
            height={data.length > 8 ? 46 : 30}
          />
          <YAxis tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => formatMoney(v, currency, 0)} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={tooltipStyle}
            formatter={(v, name) => [formatMoney(Number(v), currency), name === "allTime" ? "All-time" : "Last 12m"]}
            labelFormatter={(label, payload) => (payload?.[0]?.payload as { fullName?: string })?.fullName ?? String(label)}
          />
          <Bar dataKey="allTime" fill="var(--blue)" radius={[5, 5, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
