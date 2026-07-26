"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import type { HoldingGrowth } from "@/lib/analytics";
import { formatPct, prettyTicker } from "@/lib/analytics";

export default function GrowthByHolding({ data }: { data: HoldingGrowth[] }) {
  const chartData = data.map((d) => ({ name: prettyTicker(d.ticker), fullName: d.name, growthPct: d.growth * 100 }));

  if (chartData.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-2">Needs at least two years of dividend history per holding.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border-soft)" />
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--muted-2)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={chartData.length > 8 ? -35 : 0}
            textAnchor={chartData.length > 8 ? "end" : "middle"}
            height={chartData.length > 8 ? 46 : 30}
          />
          <YAxis tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={tooltipStyle}
            formatter={(v) => [formatPct(Number(v) / 100, 1), "12m vs prior 12m"]}
            labelFormatter={(label, payload) => (payload?.[0]?.payload as { fullName?: string })?.fullName ?? String(label)}
          />
          <Bar dataKey="growthPct" radius={[5, 5, 0, 0]} maxBarSize={36}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.growthPct >= 0 ? "var(--primary)" : "var(--red)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
