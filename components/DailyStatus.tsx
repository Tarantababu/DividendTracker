"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, prettyTicker } from "@/lib/analytics";
import type { DividendItem } from "@/lib/types";
import { evaluateSignal, type Quote, type WatchItem } from "@/lib/signals";

interface DayPoint {
  date: string;
  value: number;
  cost: number;
}

type EventKind = "dividend" | "deposit" | "withdrawal" | "buy" | "sell";

interface PortfolioEvent {
  date: string;
  kind: EventKind;
  label: string;
  amount: number;
}

const EVENT_META: Record<EventKind, { color: string; label: string }> = {
  dividend: { color: "var(--accent)", label: "Dividend" },
  deposit: { color: "var(--blue)", label: "Deposit" },
  withdrawal: { color: "#f5a623", label: "Withdrawal" },
  buy: { color: "var(--primary)", label: "Buy" },
  sell: { color: "var(--red)", label: "Sell" },
};
const EVENT_KINDS = Object.keys(EVENT_META) as EventKind[];

interface ChartPoint extends DayPoint {
  events?: PortfolioEvent[];
  // one dataKey per kind so recharts draws a dot of that color on the curve
  dividend?: number;
  deposit?: number;
  withdrawal?: number;
  buy?: number;
  sell?: number;
}

interface Mover {
  t212Ticker: string;
  ticker: string;
  name: string;
  value: number;
  dayChange: number;
  dayChangePct: number;
}

interface HistoryPayload {
  history: DayPoint[];
  today: { change: number; changePct: number; movers: Mover[]; asOf: string };
  unresolved: string[];
}

interface TriggeredSignal {
  symbol: string;
  kind: "buy" | "sell";
  price: number;
  currency: string;
}

const RANGES = [
  { label: "1M", days: 31 },
  { label: "3M", days: 93 },
  { label: "6M", days: 186 },
  { label: "1Y", days: 3660 },
] as const;

const SIGNALS_KEY = "dividend-tracker-signals-v1";

function EventTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0].payload;
  const gain = pt.cost > 0 ? pt.value - pt.cost : null;
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-xs shadow-lg">
      <div className="font-medium">{pt.date}</div>
      <div className="num mt-0.5">
        Value <span className="font-semibold">{formatMoney(pt.value, currency)}</span>
      </div>
      {pt.cost > 0 && (
        <div className="num mt-0.5 text-muted">
          Invested {formatMoney(pt.cost, currency)}
          {gain != null && (
            <span className={gain >= 0 ? "text-accent" : "text-red"}>
              {" · "}
              {gain >= 0 ? "+" : ""}
              {formatMoney(gain, currency)}
            </span>
          )}
        </div>
      )}
      {pt.events && pt.events.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-border-soft pt-1.5">
          {pt.events.map((ev, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: EVENT_META[ev.kind].color }} />
              <span>{ev.label}</span>
              <span className="num ml-auto pl-3 text-muted">
                {ev.amount >= 0 ? "+" : ""}
                {formatMoney(ev.amount, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DailyStatus({ dividends, currency }: { dividends: DividendItem[]; currency: string }) {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState(0.05);
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("6M");
  const [triggered, setTriggered] = useState<TriggeredSignal[]>([]);
  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const [eventNotes, setEventNotes] = useState<string[]>([]);

  // The reconstruction replays every order fill against historical prices, so on a
  // cold cache it can take a while. Ease a bar toward 90% while it runs — there are
  // no milestones to hook into, but silence for that long reads as "broken".
  useEffect(() => {
    if (data || error) return;
    const t = setInterval(() => setProgress((p) => (p < 0.9 ? p + (0.9 - p) * 0.04 : p)), 400);
    return () => clearInterval(t);
  }, [data, error]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolio-history");
        if (!res.ok) throw new Error();
        const payload = (await res.json()) as HistoryPayload;
        if (!cancelled) {
          setProgress(1);
          setData(payload);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    (async () => {
      try {
        const res = await fetch("/api/events");
        if (!res.ok) return;
        const payload = (await res.json()) as { events: PortfolioEvent[]; notes: string[] };
        if (!cancelled) {
          setEvents(payload.events ?? []);
          setEventNotes(payload.notes ?? []);
        }
      } catch {
        /* markers are optional garnish */
      }
    })();

    // Triggered price-target signals from the watchlist (user or model levels)
    (async () => {
      try {
        const raw = localStorage.getItem(SIGNALS_KEY);
        if (!raw) return;
        const items = ((JSON.parse(raw) as { items?: WatchItem[] }).items ?? []).filter(Boolean);
        if (items.length === 0) return;
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(items.map((i) => i.symbol).join(","))}`);
        if (!res.ok) return;
        const { quotes } = (await res.json()) as { quotes: Quote[] };
        const byorder: TriggeredSignal[] = [];
        for (const q of quotes) {
          const item = items.find((i) => i.symbol === q.symbol);
          if (!item) continue;
          const sig = evaluateSignal(q, item);
          if (sig.targetHit) byorder.push({ symbol: q.symbol, kind: sig.targetHit, price: q.price, currency: q.currency });
        }
        if (!cancelled) setTriggered(byorder);
      } catch {
        /* watchlist signals are optional garnish */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const [todayISO] = useState(() => new Date().toISOString().slice(0, 10));
  const dividendsToday = useMemo(() => dividends.filter((d) => d.paidOn.slice(0, 10) === todayISO), [dividends, todayISO]);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!data || data.history.length === 0) return [];
    const days = RANGES.find((r) => r.label === range)!.days;
    const last = data.history[data.history.length - 1].date;
    const cutoff = new Date(new Date(last + "T00:00:00Z").getTime() - days * 86400000).toISOString().slice(0, 10);
    const visible = data.history.filter((p) => p.date >= cutoff);

    // Attach events to the nearest chart day (weekend events roll forward to Monday's point)
    const byDate = new Map(visible.map((p, i) => [p.date, i]));
    const points: ChartPoint[] = visible.map((p) => ({ ...p }));
    for (const ev of events) {
      if (ev.date < cutoff || points.length === 0) continue;
      let idx = byDate.get(ev.date);
      if (idx === undefined) {
        idx = points.findIndex((p) => p.date > ev.date);
        if (idx === -1) idx = points.length - 1;
      }
      const pt = points[idx];
      (pt.events ??= []).push(ev);
      pt[ev.kind] = pt.value; // dot rides on the value curve
    }
    return points;
  }, [data, range, events]);

  const rangeChange = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0].value;
    const last = chartData[chartData.length - 1].value;
    return first > 0 ? { abs: last - first, pct: last / first - 1 } : null;
  }, [chartData]);

  if (error) {
    return (
      <section className="rounded-xl border border-border bg-card p-5 text-sm text-muted shadow-sm">
        Daily status unavailable — price history could not be loaded right now.
      </section>
    );
  }

  const up = (data?.today.change ?? 0) >= 0;
  const winners = data?.today.movers.filter((m) => m.dayChange > 0.005).slice(0, 5) ?? [];
  const losers = [...(data?.today.movers ?? [])].reverse().filter((m) => m.dayChange < -0.005).slice(0, 5);

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-wide">Today &amp; portfolio history</h2>
          <p className="mt-0.5 text-xs text-muted-2">
            Day change per holding · value vs invested, reconstructed from your order history (shares held each day × historical prices, FX-adjusted) — approximate
          </p>
        </div>
        {data && (
          <div className={`num text-lg font-semibold ${up ? "text-accent" : "text-red"}`}>
            {up ? "▲" : "▼"} {formatMoney(Math.abs(data.today.change), currency)}
            <span className="ml-1 text-sm">({(data.today.changePct * 100).toFixed(2)}%)</span>
            <span className="ml-2 text-xs font-normal text-muted-2">today</span>
          </div>
        )}
      </div>

      {!data && (
        <div className="flex h-56 items-center justify-center">
          <div className="w-full max-w-xs">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">
                {progress < 0.35 ? "Reading your order history…" : progress < 0.7 ? "Fetching historical prices…" : "Rebuilding the timeline…"}
              </span>
              <span className="num text-xs text-muted-2">{Math.round(progress * 100)}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500 ease-out" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-2">Replaying every order against historical prices — cached afterwards, so this is a one-off.</p>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Value chart */}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setRange(r.label)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${range === r.label ? "bg-[var(--primary)] text-[var(--primary-fg)]" : "text-muted hover:text-foreground"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {rangeChange && (
              <span className={`num text-xs ${rangeChange.abs >= 0 ? "text-accent" : "text-red"}`}>
                {rangeChange.abs >= 0 ? "+" : ""}
                {formatMoney(rangeChange.abs, currency, 0)} ({(rangeChange.pct * 100).toFixed(1)}%) over {range}
              </span>
            )}
          </div>
          <div className="mt-2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--muted-2)", fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(5)}
                  minTickGap={40}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fill: "var(--muted-2)", fontSize: 11 }}
                  tickFormatter={(v: number) => formatMoney(v, currency, 0)}
                  width={70}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<EventTooltip currency={currency} />} />
                <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={1.8} fill="url(#pvFill)" />
                {/* stepAfter, not monotone — the invested line is cumulative capital;
                    steps at each buy read as real deposits instead of a smoothed diagonal */}
                <Line type="stepAfter" dataKey="cost" stroke="var(--muted-2)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                {EVENT_KINDS.map((kind) => (
                  <Line
                    key={kind}
                    dataKey={kind}
                    stroke="none"
                    isAnimationActive={false}
                    dot={{ r: 3.5, fill: EVENT_META[kind].color, strokeWidth: 1, stroke: "var(--card)" }}
                    activeDot={{ r: 5, fill: EVENT_META[kind].color }}
                    legendType="none"
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend — invested line + event kinds visible in the current range */}
          {(() => {
            const present = EVENT_KINDS.filter((k) => chartData.some((p) => p[k] !== undefined));
            const hasCost = chartData.some((p) => p.cost > 0);
            if (present.length === 0 && !hasCost) return null;
            return (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                {hasCost && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: "var(--muted-2)" }} />
                    Invested
                  </span>
                )}
                {present.map((k) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: EVENT_META[k].color }} />
                    {EVENT_META[k].label}
                  </span>
                ))}
                {present.length > 0 && <span className="text-muted-2">— hover a dot for details</span>}
              </div>
            );
          })()}

          {/* Today detail: movers, dividends, signals */}
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Winners today</div>
              <ul className="mt-1.5 space-y-1 text-xs">
                {winners.length === 0 && <li className="text-muted-2">none</li>}
                {winners.map((m) => (
                  <li key={m.t212Ticker} className="flex items-center gap-2">
                    <span className="truncate">{m.ticker}</span>
                    <span className="num ml-auto text-accent">
                      +{formatMoney(m.dayChange, currency)} ({(m.dayChangePct * 100).toFixed(1)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Losers today</div>
              <ul className="mt-1.5 space-y-1 text-xs">
                {losers.length === 0 && <li className="text-muted-2">none</li>}
                {losers.map((m) => (
                  <li key={m.t212Ticker} className="flex items-center gap-2">
                    <span className="truncate">{m.ticker}</span>
                    <span className="num ml-auto text-red">
                      {formatMoney(m.dayChange, currency)} ({(m.dayChangePct * 100).toFixed(1)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Dividends &amp; signals today</div>
              <ul className="mt-1.5 space-y-1 text-xs">
                {dividendsToday.length === 0 && triggered.length === 0 && <li className="text-muted-2">no dividends received, no targets hit</li>}
                {dividendsToday.map((d, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="truncate">{prettyTicker(d.ticker)} dividend</span>
                    <span className="num ml-auto text-accent">+{formatMoney(d.amount, currency)}</span>
                  </li>
                ))}
                {triggered.map((t) => (
                  <li key={t.symbol} className="flex items-center gap-2">
                    <a href="/signals" className={`font-semibold ${t.kind === "buy" ? "text-accent" : "text-red"} hover:underline`}>
                      {t.kind.toUpperCase()} {t.symbol}
                    </a>
                    <span className="num ml-auto text-muted">@ {formatMoney(t.price, t.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {data.unresolved.length > 0 && (
            <p className="mt-3 text-[10px] text-muted-2">Not in the reconstruction (no price data found): {data.unresolved.join(", ")}</p>
          )}
          {eventNotes.length > 0 && <p className="mt-1 text-[10px] text-muted-2">Event markers: {eventNotes.join(" · ")}</p>}
        </>
      )}
    </section>
  );
}
