"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import type { YearlyByMonth } from "@/lib/analytics";
import { formatMoney } from "@/lib/analytics";

const YEAR_COLORS = ["#f5a623", "#38a6f8", "#6d4aff", "#34d399", "#f472b6"];

export default function DividendGrowth({ data, years, currency }: { data: YearlyByMonth[]; years: string[]; currency: string }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border-soft)" />
          <XAxis dataKey="label" tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => formatMoney(v, currency, 0)} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={tooltipStyle}
            formatter={(v, name) => [formatMoney(Number(v), currency), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
          {years.map((y, i) => (
            <Bar key={y} dataKey={y} fill={YEAR_COLORS[i % YEAR_COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={16} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
