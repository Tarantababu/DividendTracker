"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/analytics";
import type { PortfolioHistoryPayload } from "@/app/api/portfolio-history/route";

// A single stock or a category, plus enough to rebuild its history from the
// per-holding series. For a category, `members` carries each ticker's share.
export type HistoryTarget =
  | { kind: "ticker"; ticker: string; name: string; color?: string }
  | { kind: "category"; name: string; color?: string; members: { ticker: string; frac: number }[] };

const OPEN_EVENT = "open-history";

/** Fire from anywhere (a ticker row, a category header) to open the history modal. */
export function openHistory(target: HistoryTarget) {
  window.dispatchEvent(new CustomEvent<HistoryTarget>(OPEN_EVENT, { detail: target }));
}

// Module-level cache so repeated opens don't refetch the (server-cached) history.
let cache: PortfolioHistoryPayload | null = null;

const RANGES = [
  { key: "1M", days: 31 },
  { key: "3M", days: 92 },
  { key: "6M", days: 183 },
  { key: "1Y", days: 366 },
  { key: "All", days: Infinity },
] as const;

interface Pt {
  date: string;
  value: number;
  invested: number;
}

function buildSeries(payload: PortfolioHistoryPayload, target: HistoryTarget): Pt[] {
  const dates = payload.history.map((h) => h.date);
  const byTicker = new Map(payload.perHolding.map((h) => [h.t212Ticker, h]));
  if (target.kind === "ticker") {
    const h = byTicker.get(target.ticker);
    if (!h) return [];
    return dates.map((d, i) => ({ date: d, value: h.values[i] ?? 0, invested: h.costs[i] ?? 0 }));
  }
  return dates.map((d, i) => {
    let value = 0;
    let invested = 0;
    for (const m of target.members) {
      const h = byTicker.get(m.ticker);
      if (h) {
        value += (h.values[i] ?? 0) * m.frac;
        invested += (h.costs[i] ?? 0) * m.frac;
      }
    }
    return { date: d, value, invested };
  });
}

export default function HistoryModal({ currency }: { currency: string }) {
  const [target, setTarget] = useState<HistoryTarget | null>(null);
  const [payload, setPayload] = useState<PortfolioHistoryPayload | null>(cache);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("6M");

  useEffect(() => {
    const onOpen = (e: Event) => {
      setTarget((e as CustomEvent<HistoryTarget>).detail);
      if (!cache) {
        fetch("/api/portfolio-history")
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((j: PortfolioHistoryPayload) => {
            cache = j;
            setPayload(j);
          })
          .catch(() => {});
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTarget(null);
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const color = target?.color ?? "#6d4aff";
  const full = useMemo(() => (payload && target ? buildSeries(payload, target) : []), [payload, target]);
  const series = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    return days === Infinity ? full : full.slice(Math.max(0, full.length - days));
  }, [full, range]);

  if (!target) return null;

  const last = series[series.length - 1];
  const gain = last ? last.value - last.invested : 0;
  const gainPct = last && last.invested > 0 ? (gain / last.invested) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTarget(null)}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
            <div>
              <h2 className="text-base font-semibold leading-tight">{target.name}</h2>
              <p className="text-xs text-muted-2">{target.kind === "ticker" ? "Holding history" : "Category history"} · value vs invested</p>
            </div>
          </div>
          <button onClick={() => setTarget(null)} className="rounded-lg px-2 py-1 text-muted-2 hover:bg-card-hover hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>

        {last && (
          <div className="num mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-muted-2">Value </span>
              {formatMoney(last.value, currency, 0)}
            </span>
            <span>
              <span className="text-muted-2">Invested </span>
              {formatMoney(last.invested, currency, 0)}
            </span>
            <span className={gain >= 0 ? "text-accent" : "text-red"}>
              {gain >= 0 ? "+" : ""}
              {formatMoney(gain, currency, 0)} ({gainPct.toFixed(1)}%)
            </span>
          </div>
        )}

        <div className="mt-3 flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${range === r.key ? "bg-[var(--primary)] text-white" : "bg-surface text-muted hover:text-foreground"}`}
            >
              {r.key}
            </button>
          ))}
        </div>

        <div className="mt-3 h-64">
          {!payload ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-2">Loading history…</div>
          ) : series.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-2">No reconstructed history for this selection.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted-2)" }} minTickGap={40} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-2)" }} width={44} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)", fontSize: 12 }}
                  formatter={(v, n) => [formatMoney(Number(v), currency, 0), n === "value" ? "Value" : "Invested"]}
                />
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#histFill)" isAnimationActive={false} />
                <Line type="stepAfter" dataKey="invested" stroke="var(--muted-2)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
