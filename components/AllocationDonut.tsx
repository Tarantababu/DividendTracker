"use client";

import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Position } from "@/lib/types";
import { formatMoney, prettyTicker } from "@/lib/analytics";
import { categorySlices, useAllocation, type PieLike } from "@/lib/allocation";

const COLORS = ["#6d4aff", "#8b5cf6", "#38a6f8", "#22d3ee", "#34d399", "#a78bfa", "#f5a623", "#f472b6", "#60a5fa", "#c4b5fd"];

interface Slice {
  name: string;
  fullName: string;
  value: number;
  color: string;
  targetPct?: number | null;
}

export default function AllocationDonut({ positions, currency }: { positions: Position[]; currency: string }) {
  const { categories } = useAllocation();
  const [mode, setMode] = useState<"category" | "holding">("category");
  const [pies, setPies] = useState<PieLike[] | null>(null);
  const useCategories = categories.length > 0 && mode === "category";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pies");
        if (!res.ok) return;
        const payload = (await res.json()) as { pies: PieLike[] };
        if (!cancelled) setPies(payload.pies ?? []);
      } catch {
        /* fall back to reconstructed split */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const total = positions.reduce((s, p) => s + p.walletImpact.currentValue, 0);

  let data: Slice[];
  if (useCategories) {
    data = categorySlices(categories, positions, pies)
      .filter((s) => s.value > 0)
      .map((s) => ({
        name: s.name,
        fullName: s.targetPct != null ? `target ${s.targetPct.toFixed(0)}%` : "not in any category",
        value: s.value,
        color: s.color,
        targetPct: s.targetPct,
      }));
  } else {
    const sorted = [...positions].sort((a, b) => b.walletImpact.currentValue - a.walletImpact.currentValue);
    const top = sorted.slice(0, 9);
    const restValue = sorted.slice(9).reduce((s, p) => s + p.walletImpact.currentValue, 0);
    data = [
      ...top.map((p, i) => ({
        name: prettyTicker(p.instrument.ticker),
        fullName: p.instrument.name,
        value: p.walletImpact.currentValue,
        color: COLORS[i % COLORS.length],
      })),
      ...(restValue > 0 ? [{ name: "Other", fullName: `${sorted.length - 9} more holdings`, value: restValue, color: COLORS[9] }] : []),
    ];
  }

  return (
    <div>
      {categories.length > 0 && (
        <div className="mb-2 flex w-fit items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
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
      <div className={`flex items-center gap-2 ${categories.length > 0 ? "h-63" : "h-72"}`}>
        <div className="h-full flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} strokeWidth={0}>
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
        <ul className="w-44 space-y-1.5 overflow-y-auto pr-1 text-xs">
          {data.map((d) => {
            const pct = total > 0 ? (d.value / total) * 100 : 0;
            const drift = useCategories && d.targetPct != null ? pct - d.targetPct : null;
            return (
              <li key={d.name} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                <span className="truncate text-muted">{d.name}</span>
                <span className="num ml-auto shrink-0 text-muted-2">
                  {pct.toFixed(1)}%
                  {drift != null && Math.abs(drift) >= 0.5 && (
                    <span className={drift > 0 ? "text-red" : "text-accent"} title={`target ${d.targetPct}%`}>
                      {" "}
                      {drift > 0 ? "+" : ""}
                      {drift.toFixed(0)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
