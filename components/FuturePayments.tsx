"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FuturePayment } from "@/lib/analytics";
import { formatMoney, prettyTicker } from "@/lib/analytics";

export default function FuturePayments({ data, currency }: { data: FuturePayment[]; currency: string }) {
  const next12m = data.reduce((s, d) => s + d.total, 0);

  return (
    <div>
      <div className="mb-3 flex gap-6">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-2">Next 12m</div>
          <div className="num text-xl font-semibold text-primary">{formatMoney(next12m, currency)}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-2">Monthly</div>
          <div className="num text-xl font-semibold text-blue">{formatMoney(next12m / 12, currency)}</div>
        </div>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border-soft)" />
            <XAxis dataKey="label" tick={{ fill: "var(--muted-2)", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)", fontSize: 12 }}
              formatter={(v) => [formatMoney(Number(v), currency), "Projected"]}
              labelFormatter={(label, payload) => {
                const p = payload?.[0]?.payload as FuturePayment | undefined;
                if (!p) return String(label);
                const detail = p.byTicker.slice(0, 5).map((t) => `${prettyTicker(t.ticker)} ${formatMoney(t.amount, currency)}`).join(" · ");
                return `${label}${detail ? ` — ${detail}` : ""}`;
              }}
            />
            <Bar dataKey="total" fill="var(--blue)" radius={[5, 5, 0, 0]} maxBarSize={26}>
              <LabelList
                dataKey="total"
                position="top"
                formatter={(v: unknown) => (Number(v) > 0 ? formatMoney(Number(v), currency, 0) : "")}
                style={{ fill: "var(--muted)", fontSize: 10, fontVariantNumeric: "tabular-nums" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
