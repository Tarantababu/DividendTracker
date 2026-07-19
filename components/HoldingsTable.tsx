"use client";

import { useMemo, useState } from "react";
import type { Position } from "@/lib/types";
import type { TickerDividendStats } from "@/lib/analytics";
import { formatMoney, formatPct, prettyTicker } from "@/lib/analytics";
import { tickerCategoryIndex, useAllocation } from "@/lib/allocation";

type SortKey = "value" | "pl" | "yield" | "ttm" | "weight" | "cat";

function Th({
  label,
  k,
  align = "right",
  sortKey,
  onSort,
}: {
  label: string;
  k?: SortKey;
  align?: "left" | "right";
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-2 ${align === "left" ? "text-left" : "text-right"} ${k ? "cursor-pointer select-none hover:text-muted" : ""} ${k === sortKey ? "text-accent" : ""}`}
      onClick={k ? () => onSort(k) : undefined}
    >
      {label}
      {k === sortKey ? " ↓" : ""}
    </th>
  );
}

export default function HoldingsTable({
  positions,
  divStats,
  currency,
}: {
  positions: Position[];
  divStats: TickerDividendStats[];
  currency: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const statByTicker = useMemo(() => new Map(divStats.map((s) => [s.ticker, s])), [divStats]);
  const totalValue = positions.reduce((s, p) => s + p.walletImpact.currentValue, 0);
  const { categories } = useAllocation();
  const catLookup = useMemo(() => tickerCategoryIndex(categories), [categories]);
  const hasCategories = categories.length > 0;

  const rows = useMemo(() => {
    const r = positions.map((p) => {
      const stat = statByTicker.get(p.instrument.ticker);
      return {
        p,
        cat: catLookup.get(p.instrument.ticker) ?? null,
        ttm: stat?.ttm ?? 0,
        yieldOnValue: stat?.yieldOnValue ?? null,
        yieldOnCost: stat?.yieldOnCost ?? null,
        weight: totalValue > 0 ? p.walletImpact.currentValue / totalValue : 0,
      };
    });
    if (sortKey === "cat") {
      return r.sort(
        (a, b) =>
          (a.cat?.index ?? 999) - (b.cat?.index ?? 999) || b.p.walletImpact.currentValue - a.p.walletImpact.currentValue,
      );
    }
    const val = (x: (typeof r)[number]) =>
      sortKey === "value" ? x.p.walletImpact.currentValue
      : sortKey === "pl" ? x.p.walletImpact.unrealizedProfitLoss
      : sortKey === "yield" ? (x.yieldOnValue ?? -1)
      : sortKey === "ttm" ? x.ttm
      : x.weight;
    return r.sort((a, b) => val(b) - val(a));
  }, [positions, statByTicker, sortKey, totalValue, catLookup]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <Th label="Holding" align="left" sortKey={sortKey} onSort={setSortKey} />
            {hasCategories && <Th label="Category" k="cat" align="left" sortKey={sortKey} onSort={setSortKey} />}
            <Th label="Shares" sortKey={sortKey} onSort={setSortKey} />
            <Th label="Avg price" sortKey={sortKey} onSort={setSortKey} />
            <Th label="Price" sortKey={sortKey} onSort={setSortKey} />
            <Th label="Value" k="value" sortKey={sortKey} onSort={setSortKey} />
            <Th label="Weight" k="weight" sortKey={sortKey} onSort={setSortKey} />
            <Th label="P/L" k="pl" sortKey={sortKey} onSort={setSortKey} />
            <Th label="Divs 12m" k="ttm" sortKey={sortKey} onSort={setSortKey} />
            <Th label="Yield" k="yield" sortKey={sortKey} onSort={setSortKey} />
            <Th label="YoC" sortKey={sortKey} onSort={setSortKey} />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, cat, ttm, yieldOnValue, yieldOnCost, weight }) => {
            const pl = p.walletImpact.unrealizedProfitLoss;
            const plPct = p.walletImpact.totalCost > 0 ? pl / p.walletImpact.totalCost : null;
            return (
              <tr key={p.instrument.ticker} className="border-b border-border-soft transition-colors hover:bg-card-hover">
                <td className="max-w-56 px-3 py-2.5">
                  <div className="font-medium">{prettyTicker(p.instrument.ticker)}</div>
                  <div className="truncate text-xs text-muted-2">{p.instrument.name}</div>
                </td>
                {hasCategories && (
                  <td className="px-3 py-2.5">
                    {cat ? (
                      <span
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: `color-mix(in srgb, ${cat.color} 14%, transparent)`, color: cat.color }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
                        {cat.name}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-2">—</span>
                    )}
                  </td>
                )}
                <td className="num px-3 py-2.5 text-right text-muted">{p.quantity.toLocaleString("en-GB", { maximumFractionDigits: 4 })}</td>
                <td className="num px-3 py-2.5 text-right text-muted">
                  {p.averagePricePaid.toLocaleString("en-GB", { maximumFractionDigits: 2 })} <span className="text-muted-2">{p.instrument.currency}</span>
                </td>
                <td className="num px-3 py-2.5 text-right text-muted">
                  {p.currentPrice.toLocaleString("en-GB", { maximumFractionDigits: 2 })} <span className="text-muted-2">{p.instrument.currency}</span>
                </td>
                <td className="num px-3 py-2.5 text-right font-medium">{formatMoney(p.walletImpact.currentValue, currency)}</td>
                <td className="num px-3 py-2.5 text-right text-muted">{(weight * 100).toFixed(1)}%</td>
                <td className={`num px-3 py-2.5 text-right ${pl >= 0 ? "text-accent" : "text-red"}`}>
                  {formatMoney(pl, currency)}
                  {plPct !== null && <span className="ml-1 text-xs opacity-70">({formatPct(plPct, 1)})</span>}
                </td>
                <td className="num px-3 py-2.5 text-right">{ttm > 0 ? formatMoney(ttm, currency) : <span className="text-muted-2">—</span>}</td>
                <td className="num px-3 py-2.5 text-right">{yieldOnValue ? formatPct(yieldOnValue) : <span className="text-muted-2">—</span>}</td>
                <td className="num px-3 py-2.5 text-right text-muted">{yieldOnCost ? formatPct(yieldOnCost) : <span className="text-muted-2">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
