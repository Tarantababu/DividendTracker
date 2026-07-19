"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthlyDividend } from "@/lib/analytics";
import { formatMoney } from "@/lib/analytics";

export default function MonthlyChart({ data, currency, avg }: { data: MonthlyDividend[]; currency: string; avg: number }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border-soft)" />
          <XAxis dataKey="label" tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis
            tick={{ fill: "var(--muted-2)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(v: number) => formatMoney(v, currency, 0)}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--foreground)",
              fontSize: 12,
            }}
            formatter={(v) => [formatMoney(Number(v), currency), "Dividends"]}
          />
          <ReferenceLine y={avg} stroke="var(--amber)" strokeDasharray="4 4" strokeOpacity={0.7} />
          <Bar dataKey="total" fill="var(--primary)" radius={[5, 5, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
