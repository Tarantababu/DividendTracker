"use client";

import type { Position } from "@/lib/types";
import { formatMoney } from "@/lib/analytics";
import { categorySlices, useLiveCategories, usePies, type PieLike } from "@/lib/allocation";

/**
 * Compact target-vs-actual view of the allocation — categories come live from the
 * Trading212 pies (source of truth), or the saved allocation when pies are absent.
 */
export default function CategoryOverview({ positions, currency, pies: piesProp }: { positions: Position[]; currency: string; pies?: PieLike[] }) {
  const pies = usePies(piesProp);
  const categories = useLiveCategories(pies);

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
          <p className="mt-0.5 text-xs text-muted-2">Actual weight (bar) against each Trading212 pie's target (marker) — categories come live from your pies</p>
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
