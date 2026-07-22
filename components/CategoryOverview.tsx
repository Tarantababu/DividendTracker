"use client";

import { useEffect, useState } from "react";
import type { Position } from "@/lib/types";
import { formatMoney } from "@/lib/analytics";
import { categorySlices, useAllocation, type PieLike } from "@/lib/allocation";

/**
 * Compact target-vs-actual view of the user's category allocation.
 * Renders nothing until categories exist (created on the Allocation tab).
 */
export default function CategoryOverview({ positions, currency }: { positions: Position[]; currency: string }) {
  const { categories } = useAllocation();
  const [pies, setPies] = useState<PieLike[] | null>(null);

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

  if (categories.length === 0) return null;

  // Real pie value per category when matched; reconstructed split as fallback.
  const slices = categorySlices(categories, positions, pies);
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-wide">Allocation vs targets</h2>
          <p className="mt-0.5 text-xs text-muted-2">Actual weight (bar) against your category targets (marker) — manage them on the Allocation tab</p>
        </div>
      </div>
      <ul className="space-y-3">
        {slices.map((s) => {
          const pct = (s.value / total) * 100;
          const drift = s.targetPct != null ? pct - s.targetPct : null;
          return (
            <li key={s.name}>
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="truncate font-medium">{s.name}</span>
                <span className="num text-muted-2">{formatMoney(s.value, currency, 0)}</span>
                <span className="num ml-auto shrink-0">
                  {pct.toFixed(1)}%
                  {s.targetPct != null && <span className="text-muted-2"> / {s.targetPct.toFixed(0)}%</span>}
                </span>
                {drift != null && Math.abs(drift) >= 0.5 && (
                  <span className={`num shrink-0 ${drift > 0 ? "text-red" : "text-accent"}`}>
                    {drift > 0 ? "+" : ""}
                    {drift.toFixed(1)} pt
                  </span>
                )}
              </div>
              <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: s.color }} />
                {s.targetPct != null && (
                  <span
                    className="absolute top-0 h-full w-0.5 bg-foreground/60"
                    style={{ left: `${Math.min(100, s.targetPct)}%` }}
                    title={`target ${s.targetPct.toFixed(0)}%`}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
