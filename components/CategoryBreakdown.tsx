"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/analytics";
import type { TickerDividendStats } from "@/lib/analytics";
import type { DividendItem, Position } from "@/lib/types";
import { CATEGORY_COLORS, piesByCategoryName, pieValueByTicker, normalizePieName, tickerSplits, useLiveCategories, usePies, type PieLike } from "@/lib/allocation";
import { openHistory } from "@/components/HistoryModal";
import type { HoldingSeries } from "@/app/api/portfolio-history/route";

interface HistoryPayload {
  history: { date: string; value: number; cost: number }[];
  perHolding: HoldingSeries[];
}

interface CatPoint {
  date: string;
  value: number;
  cost: number;
  withDiv: number; // value + cumulative dividends received to date (total return trajectory)
}

interface CategoryStat {
  name: string;
  color: string;
  value: number; // current market value
  invested: number; // current cost basis
  ttmDividends: number;
  allDividends: number; // dividends received since inception
  yieldOnValue: number | null;
  yieldOnCost: number | null;
  series: CatPoint[]; // value + invested + total-return over time
  members: { ticker: string; frac: number }[]; // for the click-through history modal
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(2)}%`;
}

/** Mini chart per category: value (area), invested (stepped dashed), total return incl. dividends. */
function MiniHistory({ series, color, currency }: { series: CatPoint[]; color: string; currency: string }) {
  if (series.length < 2) return <div className="h-24" />;
  const gid = `cg-${color.replace("#", "")}`;
  return (
    <div className="h-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 11 }}
            labelFormatter={(d) => String(d)}
            formatter={(v, n) => [formatMoney(Number(v), currency, 0), n === "value" ? "Value" : n === "cost" ? "Invested" : "Incl. dividends"]}
          />
          {/* total return sits above value; the gap is dividends earned */}
          <Line type="monotone" dataKey="withDiv" stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.6} fill={`url(#${gid})`} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="cost" stroke="var(--muted-2)" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function CategoryBreakdown({ positions, divStats, dividends, currency, pies: piesProp }: { positions: Position[]; divStats: TickerDividendStats[]; dividends: DividendItem[]; currency: string; pies?: PieLike[] }) {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const pies = usePies(piesProp); // exact per-category actuals; seeded from /api/overview when present
  const categories = useLiveCategories(pies); // categories derived live from the T212 pies

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio-history");
        if (!res.ok) return;
        const payload = (await res.json()) as HistoryPayload;
        if (!cancelled) setData(payload);
      } catch {
        /* history is optional enrichment */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo<CategoryStat[]>(() => {
    if (categories.length === 0) return [];
    const posByTicker = new Map(positions.map((p) => [p.instrument.ticker, p]));
    const divByTicker = new Map(divStats.map((d) => [d.ticker, d]));
    const seriesByTicker = new Map((data?.perHolding ?? []).map((s) => [s.t212Ticker, s]));
    const dates = data?.history.map((h) => h.date) ?? [];

    // Dividend payments grouped by ticker, oldest first, for the cumulative timeline
    const divsByTicker = new Map<string, { date: string; amount: number }[]>();
    for (const d of dividends) {
      const arr = divsByTicker.get(d.ticker) ?? [];
      arr.push({ date: d.paidOn.slice(0, 10), amount: d.amount });
      divsByTicker.set(d.ticker, arr);
    }
    for (const arr of divsByTicker.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

    // Prefer the real Trading212 pie for this category (exact per-ticker split);
    // otherwise fall back to the intent-based allocation split.
    const pieMap = pies ? piesByCategoryName(pies) : new Map<string, PieLike>();
    const pieValueTotals = pies ? pieValueByTicker(pies) : new Map<string, number>();
    const splits = tickerSplits(categories);
    const fallbackFraction = (ticker: string, catIdx: number) => splits.get(ticker)?.find((s) => s.categoryIndex === catIdx)?.fraction ?? 1;

    return categories.map((c, i) => {
      const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
      const pie = pieMap.get(normalizePieName(c.name));

      // Each member's real share of its total holding that belongs to THIS category.
      // From the pie when matched (ins.value / total pie value of that ticker), else intent split.
      const members = c.members
        .map((m) => m.t212Ticker)
        .filter((t): t is string => !!t)
        .map((t) => {
          if (pie) {
            const ins = pie.instruments.find((x) => x.ticker === t);
            const tot = pieValueTotals.get(t) ?? 0;
            return { t, frac: ins && tot > 0 ? ins.value / tot : 0 };
          }
          return { t, frac: fallbackFraction(t, i) };
        });

      let value = 0;
      let invested = 0;
      let ttm = 0;
      let allDiv = 0;
      if (pie) {
        // Exact top-line numbers straight from the pie. "Invested" = real net
        // deposits (money in − out) when known, else T212's cost basis.
        value = pie.value;
        invested = pie.netDeposits ?? pie.invested;
        allDiv = pie.dividendGained;
        // TTM income can't come from the pie summary — scale each member's TTM by its pie share
        for (const { t, frac } of members) ttm += (divByTicker.get(t)?.ttm ?? 0) * frac;
      } else {
        for (const { t, frac } of members) {
          const p = posByTicker.get(t);
          if (p) {
            value += p.walletImpact.currentValue * frac;
            invested += p.walletImpact.totalCost * frac;
          }
          const d = divByTicker.get(t);
          if (d) {
            ttm += d.ttm * frac;
            allDiv += d.allTime * frac;
          }
        }
      }

      // Cumulative dividends by date, each ticker scaled by this category's share
      const memberDivs = members
        .flatMap(({ t, frac }) => (divsByTicker.get(t) ?? []).map((x) => ({ date: x.date, amount: x.amount * frac })))
        .sort((a, b) => a.date.localeCompare(b.date));
      let divPtr = 0;
      let divRunning = 0;

      // History: sum member value + cost series (this category's share) by date; add total-return line
      const series: CatPoint[] = dates.map((date, idx) => {
        let v = 0;
        let cost = 0;
        for (const { t, frac } of members) {
          const s = seriesByTicker.get(t);
          if (s) {
            v += (s.values[idx] ?? 0) * frac;
            cost += (s.costs[idx] ?? 0) * frac;
          }
        }
        while (divPtr < memberDivs.length && memberDivs[divPtr].date <= date) divRunning += memberDivs[divPtr++].amount;
        return {
          date,
          value: Math.round(v * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          withDiv: Math.round((v + divRunning) * 100) / 100,
        };
      });

      return {
        name: c.name,
        color,
        value,
        invested,
        ttmDividends: ttm,
        allDividends: allDiv,
        yieldOnValue: value > 0 ? ttm / value : null,
        yieldOnCost: invested > 0 ? ttm / invested : null,
        series,
        members: members.map((m) => ({ ticker: m.t, frac: m.frac })),
      };
    });
  }, [categories, positions, divStats, dividends, data, pies]);

  if (stats.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-semibold tracking-wide">Category performance</h2>
        <p className="mt-0.5 text-xs text-muted-2">
          Value vs invested, income and yields per category — history reconstructed from your order fills{data ? "" : " (loading…)"}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {stats.map((s) => {
          // P/L against net deposits (money in − out). Dividends are shown separately
          // below rather than added here, so reinvesting pies (whose dividends are
          // already reflected in the value) aren't double-counted.
          const gain = s.value - s.invested;
          const gainPct = s.invested > 0 ? gain / s.invested : 0;
          return (
            <div key={s.name} className="rounded-xl border border-border bg-surface/40 p-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <button
                  onClick={() => openHistory({ kind: "category", name: s.name, color: s.color, members: s.members, netInvested: s.invested })}
                  className="text-sm font-semibold hover:text-primary hover:underline"
                  title="Show this category's history"
                >
                  {s.name}
                </button>
                <span
                  className={`num ml-auto text-xs ${gain >= 0 ? "text-accent" : "text-red"}`}
                  title="P/L vs net deposits (money you put in). Dividends shown separately below."
                >
                  {gain >= 0 ? "+" : ""}
                  {formatMoney(gain, currency, 0)} ({(gainPct * 100).toFixed(1)}%)
                </span>
              </div>

              <div className="mt-3">
                <MiniHistory series={s.series} color={s.color} currency={currency} />
              </div>

              <dl className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted">Value</dt>
                  <dd className="font-medium">{formatMoney(s.value, currency, 0)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted" title="Net deposits — real money in − out (from your Trading212 pie)">Invested</dt>
                  <dd className="font-medium">{formatMoney(s.invested, currency, 0)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted" title="Trailing-12-month dividends ÷ current value">
                    Yield
                  </dt>
                  <dd className="font-medium text-accent">{fmtPct(s.yieldOnValue)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted" title="Trailing-12-month dividends ÷ amount invested">
                    Yield on cost
                  </dt>
                  <dd className="font-medium text-accent">{fmtPct(s.yieldOnCost)}</dd>
                </div>
                <div className="flex justify-between border-t border-border-soft pt-1.5">
                  <dt className="text-muted" title="Dividends received since inception (shown separately; not added to the P/L above to avoid double-counting reinvested dividends)">
                    Dividends
                  </dt>
                  <dd className="font-medium">{formatMoney(s.allDividends, currency, 0)}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-[var(--primary)]/60" /> value
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-[var(--muted-2)]" /> invested (steps at each buy)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dotted border-[var(--accent)]" /> incl. dividends
        </span>
      </div>
    </section>
  );
}
