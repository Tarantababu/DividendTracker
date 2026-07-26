"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, prettyTicker } from "@/lib/analytics";
import type { OverviewPayload } from "@/lib/types";
import { evaluateSignal, fundFlags, isEtfLike, type FundInfo, type LookThroughResult, type NewsItem, type Quote, type Sentiment, type SignalResult, type WatchItem } from "@/lib/signals";
import { useAllocation, CATEGORY_COLORS } from "@/lib/allocation";

const STORAGE_KEY = "dividend-tracker-signals-v1";

interface Stored {
  items: WatchItem[];
  importedHoldings: string[]; // T212 tickers already auto-imported (so a user delete sticks)
}

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

const VERDICT_STYLE: Record<SignalResult["verdict"], { label: string; cls: string }> = {
  "strong-buy": { label: "STRONG BUY", cls: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent" },
  buy: { label: "BUY", cls: "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent" },
  hold: { label: "HOLD", cls: "bg-surface text-muted" },
  sell: { label: "SELL", cls: "bg-[color-mix(in_srgb,var(--red)_12%,transparent)] text-red" },
  "strong-sell": { label: "STRONG SELL", cls: "bg-[color-mix(in_srgb,var(--red)_18%,transparent)] text-red" },
};

function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * 100).toFixed(2)},${(30 - ((v - min) / range) * 28 + 1).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" className="h-8 w-24 shrink-0" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "var(--accent)" : "var(--red)"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function TargetInput({
  label,
  value,
  suggested,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  suggested?: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <input
        type="number"
        step="any"
        min={0}
        value={value ?? ""}
        placeholder={suggested != null ? suggested.toFixed(2) : "—"}
        title={suggested != null ? "Empty = model level (shown greyed) is used for signals" : undefined}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="num w-20 rounded-lg border border-border bg-surface px-2 py-1 text-right text-xs text-foreground outline-none placeholder:text-muted-2 focus:border-[var(--primary)]"
      />
    </label>
  );
}

const fmtPct = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;

function fmtAum(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toLocaleString();
}

const FLAG_TONE: Record<"good" | "warn" | "info", string> = {
  good: "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent",
  warn: "bg-[color-mix(in_srgb,var(--red)_12%,transparent)] text-red",
  info: "bg-surface text-muted",
};

/** ETF-specific fundamentals: cost, income, structure, exposure. */
function FundPanel({ fund, currency }: { fund: FundInfo; currency: string }) {
  const stat = (label: string, value: string, title?: string) => (
    <div className="flex justify-between gap-4" title={title}>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">Fund facts</div>
          <dl className="num mt-2 space-y-1 text-xs">
            {fund.category && stat("Category", fund.category)}
            {fund.family && stat("Provider", fund.family)}
            {fund.expenseRatio != null && stat("Expense ratio (TER)", `${(fund.expenseRatio * 100).toFixed(2)}%`, "Annual fund cost")}
            {fund.yield != null && fund.yield > 0 && stat("Distribution yield", `${(fund.yield * 100).toFixed(2)}%`)}
            {fund.aum != null && stat("Fund size (AUM)", `${currency === "USD" ? "$" : ""}${fmtAum(fund.aum)}`)}
            {fund.navPrice != null && stat("NAV", formatMoney(fund.navPrice, currency))}
            {fund.premiumPct != null && stat("Premium / discount", fmtPct(fund.premiumPct, 2), "Price vs net asset value")}
            {fund.beta3y != null && stat("Beta (3y)", fund.beta3y.toFixed(2), "Volatility vs the market")}
            {fund.threeYearReturn != null && stat("3y avg return", fmtPct(fund.threeYearReturn))}
            {fund.inceptionDate && stat("Inception", fund.inceptionDate)}
          </dl>
        </div>
        <div>
          {fund.holdings.length > 0 && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">
                Top holdings {fund.topConcentration != null && <span className="normal-case text-muted-2">· top-10 {(fund.topConcentration * 100).toFixed(0)}%</span>}
              </div>
              <ul className="mt-2 space-y-1">
                {fund.holdings.slice(0, 8).map((h) => (
                  <li key={h.symbol + h.name} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted">{h.name || h.symbol}</span>
                      <span className="num shrink-0 font-medium">{(h.weight * 100).toFixed(1)}%</span>
                    </div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface">
                      <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, h.weight * 100 * 4)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {fund.sectors.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">Sectors</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {fund.sectors.slice(0, 6).map((s) => (
                  <span key={s.sector} className="num rounded-md bg-surface px-2 py-0.5 text-[11px] text-muted">
                    {s.sector} {(s.weight * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Past 90 days + 12-month GBM forecast: expected path (dashed) inside a ±1σ band. */
function ForecastChart({ quote }: { quote: Quote }) {
  const ins = quote.insights;
  if (!ins || quote.spark.length < 2) return null;
  const muD = ins.annualDrift / 252;
  const sigmaD = ins.annualVol / Math.sqrt(252);

  const months = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const future = months.map((m) => {
    const d = (m / 12) * 252;
    const band = sigmaD * Math.sqrt(d);
    return { expected: quote.price * Math.exp(muD * d), low: quote.price * Math.exp(muD * d - band), high: quote.price * Math.exp(muD * d + band) };
  });

  const yMin = Math.min(...quote.spark, ...future.map((f) => f.low));
  const yMax = Math.max(...quote.spark, ...future.map((f) => f.high));
  const range = yMax - yMin || 1;
  const H = 44;
  const y = (v: number) => (H - 4 - ((v - yMin) / range) * (H - 8)).toFixed(2);
  const SPLIT = 38; // past gets x 0..38, forecast 38..100

  const past = quote.spark.map((v, i) => `${((i / (quote.spark.length - 1)) * SPLIT).toFixed(2)},${y(v)}`).join(" ");
  const fx = (i: number) => (SPLIT + (i / 12) * (100 - SPLIT)).toFixed(2);
  const expectedPts = future.map((f, i) => `${fx(i)},${y(f.expected)}`).join(" ");
  const bandPts = [...future.map((f, i) => `${fx(i)},${y(f.high)}`), ...[...future].reverse().map((f, i) => `${fx(12 - i)},${y(f.low)}`)].join(" ");

  return (
    <svg viewBox={`0 0 100 ${H}`} className="h-24 w-full" preserveAspectRatio="none" aria-label="Price history and 12-month forecast">
      <polygon points={bandPts} fill="color-mix(in srgb, var(--blue) 14%, transparent)" />
      <polyline points={past} fill="none" stroke="var(--primary)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <polyline points={expectedPts} fill="none" stroke="var(--blue)" strokeWidth="1.4" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <line x1={SPLIT} y1="0" x2={SPLIT} y2={H} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
    </svg>
  );
}

export default function SignalsPage() {
  const [stored, setStored] = useState<Stored>({ items: [], importedHoldings: [] });
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [funds, setFunds] = useState<Record<string, FundInfo>>({});
  const [lookthrough, setLookthrough] = useState<LookThroughResult | null>(null);
  const [news, setNews] = useState<Record<string, NewsItem[]>>({});
  const [newsLoading, setNewsLoading] = useState<Record<string, boolean>>({});
  const [sentiments, setSentiments] = useState<Record<string, Sentiment>>({});
  const [sentimentLoading, setSentimentLoading] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [insightsOpen, setInsightsOpen] = useState<Record<string, boolean>>({});
  const [fundOpen, setFundOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);
  const { categories } = useAllocation();

  // Watchlist symbol → category: match either the member's search symbol or its T212 ticker's pretty form
  const categoryOf = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    categories.forEach((c, i) => {
      const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
      for (const m of c.members) {
        map.set(m.id.toUpperCase(), { name: c.name, color });
        if (m.t212Ticker) map.set(prettyTicker(m.t212Ticker).toUpperCase(), { name: c.name, color });
      }
    });
    return map;
  }, [categories]);

  const persist = useCallback((next: Stored) => {
    setStored(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const loadQuotes = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) return;
    const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
    if (!res.ok) return;
    const data = (await res.json()) as { quotes: Quote[] };
    setQuotes((prev) => {
      const next = { ...prev };
      for (const q of data.quotes) next[q.symbol] = q;
      return next;
    });
  }, []);

  // Fund fundamentals (TER, yield, NAV, holdings, sectors) — slow-moving, best-effort
  const loadFunds = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) return;
    try {
      const res = await fetch(`/api/fund?symbols=${encodeURIComponent(symbols.join(","))}`);
      if (!res.ok) return;
      const data = (await res.json()) as { funds: FundInfo[] };
      setFunds((prev) => {
        const next = { ...prev };
        for (const f of data.funds) next[f.symbol] = f;
        return next;
      });
    } catch {
      /* fundamentals are optional enrichment */
    }
  }, []);

  // Boot: restore watchlist, auto-import T212 holdings not seen before, fetch quotes.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    (async () => {
      let s: Stored = { items: [], importedHoldings: [] };
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Stored>;
          s = { items: parsed.items ?? [], importedHoldings: parsed.importedHoldings ?? [] };
        }
      } catch {
        /* corrupted storage — start fresh */
      }

      try {
        const ovRes = await fetch("/api/overview");
        if (ovRes.ok) {
          const ov = (await ovRes.json()) as OverviewPayload;
          const fresh = ov.positions.filter((p) => !s.importedHoldings.includes(p.instrument.ticker));
          let added = 0;
          for (const p of fresh) {
            s.importedHoldings.push(p.instrument.ticker);
            const guess = prettyTicker(p.instrument.ticker);
            try {
              const sr = await fetch(`/api/stock-search?q=${encodeURIComponent(p.instrument.name)}`);
              const { results: found } = (await sr.json()) as { results: SearchResult[] };
              const best = found.find((f) => f.symbol === guess) ?? found[0];
              const symbol = best?.symbol ?? guess;
              if (!s.items.some((i) => i.symbol === symbol)) {
                s.items.push({ symbol, name: best?.name ?? p.instrument.name, fromHolding: true });
                added++;
              }
            } catch {
              if (!s.items.some((i) => i.symbol === guess)) {
                s.items.push({ symbol: guess, name: p.instrument.name, fromHolding: true });
                added++;
              }
            }
          }
          if (added > 0) setImportNote(`${added} holding${added === 1 ? "" : "s"} imported from Trading212`);
        }
      } catch {
        /* T212 down — watchlist still works */
      }

      setStored(s);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      const symbols = s.items.map((i) => i.symbol);
      await loadQuotes(symbols);
      setLoading(false);
      loadFunds(symbols); // enrich in the background; page is already usable
    })();
  }, [loadQuotes, loadFunds]);

  // Value-weighted look-through allocation (server-computed from T212 positions × ETF holdings)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lookthrough");
        if (!res.ok) return;
        const data = (await res.json()) as LookThroughResult;
        if (!cancelled) setLookthrough(data);
      } catch {
        /* optional panel */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const symbols = stored.items.map((i) => i.symbol);
    await loadQuotes(symbols);
    loadFunds(symbols);
    setRefreshing(false);
  }, [stored.items, loadQuotes, loadFunds]);

  const runSearch = useCallback((q: string) => {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/stock-search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results ?? []);
      } finally {
        setSearching(false);
      }
    }, 350);
  }, []);

  const addItem = useCallback(
    (r: SearchResult) => {
      if (!stored.items.some((i) => i.symbol === r.symbol)) {
        persist({ ...stored, items: [...stored.items, { symbol: r.symbol, name: r.name }] });
        loadQuotes([r.symbol]);
        loadFunds([r.symbol]);
      }
      setQuery("");
      setResults([]);
    },
    [stored, persist, loadQuotes, loadFunds],
  );

  const removeItem = useCallback(
    (symbol: string) => {
      persist({ ...stored, items: stored.items.filter((i) => i.symbol !== symbol) });
    },
    [stored, persist],
  );

  const setTarget = useCallback(
    (symbol: string, field: "buyBelow" | "sellAbove", v: number | null) => {
      persist({ ...stored, items: stored.items.map((i) => (i.symbol === symbol ? { ...i, [field]: v } : i)) });
    },
    [stored, persist],
  );

  const loadNews = useCallback(
    async (item: WatchItem) => {
      if (news[item.symbol] || newsLoading[item.symbol]) return;
      setNewsLoading((p) => ({ ...p, [item.symbol]: true }));
      try {
        const res = await fetch(`/api/news?symbol=${encodeURIComponent(item.symbol)}&name=${encodeURIComponent(item.name)}`);
        const data = (await res.json()) as { items: NewsItem[] };
        setNews((p) => ({ ...p, [item.symbol]: data.items ?? [] }));
      } finally {
        setNewsLoading((p) => ({ ...p, [item.symbol]: false }));
      }
    },
    [news, newsLoading],
  );

  const scoreSentiment = useCallback(
    async (item: WatchItem) => {
      const headlines = news[item.symbol];
      if (!headlines?.length || sentimentLoading[item.symbol]) return;
      setSentimentLoading((p) => ({ ...p, [item.symbol]: true }));
      try {
        const res = await fetch("/api/sentiment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: item.symbol, name: item.name, headlines }),
        });
        if (res.ok) {
          const data = (await res.json()) as { sentiment: Sentiment };
          setSentiments((p) => ({ ...p, [item.symbol]: data.sentiment }));
        }
      } finally {
        setSentimentLoading((p) => ({ ...p, [item.symbol]: false }));
      }
    },
    [news, sentimentLoading],
  );

  const rows = useMemo(() => {
    return stored.items
      .map((item) => {
        const quote = quotes[item.symbol];
        const fund = funds[item.symbol] ?? null;
        const signal = quote ? evaluateSignal(quote, item, sentiments[item.symbol], fund) : null;
        return { item, quote, signal, fund };
      })
      .sort((a, b) => {
        const ta = a.signal?.targetHit ? 1 : 0;
        const tb = b.signal?.targetHit ? 1 : 0;
        if (ta !== tb) return tb - ta;
        return Math.abs(b.signal?.score ?? 0) - Math.abs(a.signal?.score ?? 0);
      });
  }, [stored.items, quotes, sentiments, funds]);

  const triggered = rows.filter((r) => r.signal?.targetHit);
  const etfCount = Object.values(funds).filter((f) => f.isEtf).length;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Signals</h1>
        <p className="mt-0.5 text-xs text-muted-2">
          {etfCount > 0
            ? "Fund facts, cost, yield, NAV premium and look-through holdings for your ETFs — plus price targets. Signals are information, every trade stays yours"
            : "Price targets, technicals and Claude-scored news per stock — signals are information, every trade stays yours"}
          {importNote && <span className="text-accent"> · {importNote}</span>}
        </p>
      </header>

      {/* Add + refresh */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Add stock — name or ticker (US & EU)"
            className="w-full rounded-md border border-border bg-card px-3.5 py-2 text-sm outline-none placeholder:text-muted-2 focus:border-[var(--primary)]"
          />
          {(results.length > 0 || searching) && query.trim().length >= 2 && (
            <div className="absolute top-full z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
              {searching && <div className="px-3.5 py-2 text-xs text-muted-2">Searching…</div>}
              {results.map((r) => (
                <button
                  key={r.symbol}
                  onClick={() => addItem(r)}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm hover:bg-card-hover"
                >
                  <span className="truncate">{r.name}</span>
                  <span className="num shrink-0 text-xs text-muted">
                    {r.symbol} · {r.exchange}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing || loading}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-card-hover disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh prices"}
        </button>
      </div>

      {/* Triggered summary */}
      {triggered.length > 0 && (
        <div className="mb-6 rounded-xl border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_6%,var(--card))] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">Price targets hit</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {triggered.map(({ item, quote, signal }) => (
              <span key={item.symbol} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${VERDICT_STYLE[signal!.verdict].cls}`}>
                {item.symbol} · {signal!.targetHit === "buy" ? "BUY" : "SELL"} @ {quote ? formatMoney(quote.price, quote.currency) : "—"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* True look-through allocation: individual stocks across the whole portfolio */}
      {lookthrough && lookthrough.stocks.length > 0 && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">Look-through stock allocation</div>
            <div className="text-[11px] text-muted-2">
              effective weight of each company, seen through your {lookthrough.resolvedEtfs} decomposable ETFs
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-2">
            Your ETFs decomposed into the underlying stocks they actually hold, weighted by € invested — your real single-name exposure.
          </p>
          {(() => {
            const top = lookthrough.stocks.slice(0, 15);
            const maxPct = Math.max(...top.map((s) => s.pct), 0.01);
            const shownPct = top.reduce((a, s) => a + s.pct, 0);
            const restPct = Math.max(0, 1 - shownPct - lookthrough.otherPct);
            return (
              <div className="mt-3 space-y-1.5">
                {top.map((s) => (
                  <div key={s.symbol} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 truncate font-semibold" title={s.name}>
                      {s.symbol}
                    </span>
                    <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface">
                      <div className="h-full rounded bg-[var(--primary)]" style={{ width: `${(s.pct / maxPct) * 100}%` }} />
                    </div>
                    <span className="num w-12 shrink-0 text-right font-medium">{(s.pct * 100).toFixed(2)}%</span>
                    <span className="w-24 shrink-0 text-right text-[10px] text-muted-2">
                      {s.direct ? "direct" : ""}
                      {s.direct && s.funds.length > 0 ? " · " : ""}
                      {s.funds.length > 0 ? `in ${s.funds.length} ETF${s.funds.length > 1 ? "s" : ""}` : ""}
                    </span>
                  </div>
                ))}
                <div className="mt-1 flex items-center gap-2 border-t border-border-soft pt-1.5 text-xs text-muted">
                  <span className="w-16 shrink-0">Other</span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface">
                    <div className="h-full rounded bg-[var(--muted-2)] opacity-40" style={{ width: `${((restPct + lookthrough.otherPct) / maxPct) * 100}%` }} />
                  </div>
                  <span className="num w-12 shrink-0 text-right">{((restPct + lookthrough.otherPct) * 100).toFixed(1)}%</span>
                  <span className="w-24 shrink-0 text-right text-[10px] text-muted-2">diversified</span>
                </div>
              </div>
            );
          })()}
          {lookthrough.opaqueFunds && lookthrough.opaqueFunds.length > 0 && (
            <div className="mt-3 border-t border-border-soft pt-3">
              <div className="text-[11px] font-medium text-muted">Funds we couldn&apos;t look inside</div>
              <p className="text-[10px] text-muted-2">Active/UCITS funds whose holdings aren&apos;t published by our data source — shown as funds, not stocks, and counted in &ldquo;Other&rdquo;.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {lookthrough.opaqueFunds.map((f) => (
                  <span key={f.ticker} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs" title={f.name}>
                    <span className="rounded bg-[color-mix(in_srgb,var(--blue)_16%,transparent)] px-1.5 text-[10px] font-medium text-blue">ETF</span>
                    <span className="font-semibold">{f.ticker}</span>
                    <span className="num text-muted-2">{(f.pct * 100).toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-2">
            Of {formatMoney(lookthrough.totalValue, lookthrough.currency, 0)} invested, {(lookthrough.coveredPct * 100).toFixed(0)}% classified.
            &ldquo;Other&rdquo; is diversified fund exposure beyond each ETF&apos;s top-10.
            {lookthrough.unresolved.length > 0 && <span> Not looked through: {lookthrough.unresolved.join(", ")}.</span>}
          </p>
        </div>
      )}

      {loading && (
        <div className="flex min-h-48 items-center justify-center text-sm text-muted">Loading watchlist and prices…</div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted">
          No stocks yet — search above to add your first one.
        </div>
      )}

      <div className="grid gap-4">
        {rows.map(({ item, quote, signal, fund }) => {
          const up = (quote?.changePct ?? 0) >= 0;
          const isOpen = !!expanded[item.symbol];
          const sentiment = sentiments[item.symbol];
          const etf = isEtfLike(fund);
          const flags = fund ? fundFlags(fund) : [];
          return (
            <section key={item.symbol} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{item.name}</span>
                    <span className="num shrink-0 text-xs text-muted">{item.symbol}</span>
                    {etf && <span className="shrink-0 rounded bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-primary">ETF</span>}
                    {item.fromHolding && <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-2">holding</span>}
                    {(() => {
                      const cat = categoryOf.get(item.symbol.toUpperCase());
                      return cat ? (
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ background: `color-mix(in srgb, ${cat.color} 14%, transparent)`, color: cat.color }}
                        >
                          {cat.name}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  {quote ? (
                    <div className="num mt-0.5 flex items-center gap-2 text-sm">
                      <span className="font-semibold">{formatMoney(quote.price, quote.currency)}</span>
                      <span className={up ? "text-accent" : "text-red"}>
                        {up ? "▲" : "▼"} {(Math.abs(quote.changePct) * 100).toFixed(2)}%
                      </span>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-muted-2">no price data</div>
                  )}
                </div>

                {quote && <Spark data={quote.spark} up={up} />}

                {signal && (
                  <span className={`rounded-lg px-2.5 py-1.5 text-xs font-bold tracking-wide ${VERDICT_STYLE[signal.verdict].cls}`}>
                    {VERDICT_STYLE[signal.verdict].label}
                  </span>
                )}

                <button onClick={() => removeItem(item.symbol)} className="text-xs text-muted-2 hover:text-red" title="Remove">
                  ✕
                </button>
              </div>

              {/* Reasons + indicator chips */}
              {quote && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {quote.rsi14 != null && (
                    <span className="num rounded-md bg-surface px-2 py-0.5 text-[11px] text-muted" title="Relative Strength Index, 14 days">
                      RSI {quote.rsi14.toFixed(0)}
                    </span>
                  )}
                  {quote.sma50 != null && quote.sma200 != null && (
                    <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] text-muted">
                      {quote.sma50 > quote.sma200 ? "50d > 200d ↑" : "50d < 200d ↓"}
                    </span>
                  )}
                  <span className="num rounded-md bg-surface px-2 py-0.5 text-[11px] text-muted" title="52-week range">
                    52w {formatMoney(quote.low52w, quote.currency, 0)}–{formatMoney(quote.high52w, quote.currency, 0)}
                  </span>
                  {flags.map((f) => (
                    <span key={f.label} title={f.detail} className={`num rounded-md px-2 py-0.5 text-[11px] font-medium ${FLAG_TONE[f.tone]}`}>
                      {f.label}
                    </span>
                  ))}
                  {signal?.reasons
                    .filter((r) => r.direction !== "info")
                    .map((r) => (
                      <span
                        key={r.label}
                        title={r.detail}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${r.direction === "buy" ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent" : "bg-[color-mix(in_srgb,var(--red)_12%,transparent)] text-red"}`}
                      >
                        {r.label}
                      </span>
                    ))}
                </div>
              )}

              {/* Targets + expand */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <TargetInput label="Buy below" value={item.buyBelow} suggested={quote?.insights?.suggestedBuy} onChange={(v) => setTarget(item.symbol, "buyBelow", v)} />
                <TargetInput label="Sell above" value={item.sellAbove} suggested={quote?.insights?.suggestedSell} onChange={(v) => setTarget(item.symbol, "sellAbove", v)} />
                {quote?.insights && (item.buyBelow == null || item.sellAbove == null) && (
                  <button
                    onClick={() => {
                      persist({
                        ...stored,
                        items: stored.items.map((i) =>
                          i.symbol === item.symbol
                            ? { ...i, buyBelow: i.buyBelow ?? quote.insights!.suggestedBuy, sellAbove: i.sellAbove ?? quote.insights!.suggestedSell }
                            : i,
                        ),
                      });
                    }}
                    title={quote.insights.targetBasis}
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted hover:bg-card-hover"
                  >
                    Use model levels
                  </button>
                )}
                <div className="ml-auto flex items-center gap-3">
                  {fund && (fund.holdings.length > 0 || fund.category || fund.expenseRatio != null) && (
                    <button
                      onClick={() => setFundOpen((p) => ({ ...p, [item.symbol]: !p[item.symbol] }))}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {fundOpen[item.symbol] ? "Hide fund" : "Fund fundamentals"}
                    </button>
                  )}
                  {quote?.insights && (
                    <button
                      onClick={() => setInsightsOpen((p) => ({ ...p, [item.symbol]: !p[item.symbol] }))}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {insightsOpen[item.symbol] ? "Hide insights" : "Insights & forecast"}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setExpanded((p) => ({ ...p, [item.symbol]: !isOpen }));
                      if (!isOpen) loadNews(item);
                    }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {isOpen ? "Hide news" : etf ? "News" : "News & AI sentiment"}
                  </button>
                </div>
              </div>

              {fundOpen[item.symbol] && fund && <FundPanel fund={fund} currency={quote?.currency ?? "EUR"} />}

              {insightsOpen[item.symbol] && quote?.insights && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">Past 12 months</div>
                      <dl className="num mt-2 space-y-1 text-xs">
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Return</dt>
                          <dd className={quote.insights.return1y >= 0 ? "text-accent" : "text-red"}>{fmtPct(quote.insights.return1y)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Trend (annualised drift)</dt>
                          <dd>
                            {quote.insights.trend === "up" ? "↑" : quote.insights.trend === "down" ? "↓" : "→"} {fmtPct(quote.insights.annualDrift)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Volatility (annualised)</dt>
                          <dd>{(quote.insights.annualVol * 100).toFixed(1)}%</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Worst drawdown</dt>
                          <dd className="text-red">{fmtPct(quote.insights.maxDrawdown)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Position in 52w range</dt>
                          <dd>{(quote.insights.rangePos * 100).toFixed(0)}%</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted" title={quote.insights.targetBasis}>
                            Model buy / sell levels
                          </dt>
                          <dd>
                            {formatMoney(quote.insights.suggestedBuy, quote.currency)} / {formatMoney(quote.insights.suggestedSell, quote.currency)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">
                        Forecast <span className="normal-case text-muted-2">· dashed = expected · shaded = ±1σ</span>
                      </div>
                      <ForecastChart quote={quote} />
                      <table className="num w-full text-xs">
                        <tbody>
                          {quote.insights.forecast.map((f) => (
                            <tr key={f.months}>
                              <td className="py-0.5 text-muted">{f.months}m</td>
                              <td className="py-0.5 text-right font-medium">{formatMoney(f.expected, quote.currency)}</td>
                              <td className="py-0.5 text-right text-muted-2">
                                {formatMoney(f.low, quote.currency)} – {formatMoney(f.high, quote.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-[10px] leading-relaxed text-muted-2">
                        Projection of the last year&apos;s drift and volatility (GBM), not a prediction of news or fundamentals.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {isOpen && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">Latest news</div>
                    <button
                      onClick={() => scoreSentiment(item)}
                      disabled={sentimentLoading[item.symbol] || !news[item.symbol]?.length}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-card-hover disabled:opacity-50"
                    >
                      {sentimentLoading[item.symbol] ? "Claude is reading…" : sentiment ? "Re-score with Claude" : "Score with Claude"}
                    </button>
                  </div>

                  {sentiment && (
                    <div
                      className={`mt-2 rounded-xl p-3 text-xs leading-relaxed ${sentiment.stance === "bullish" ? "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : sentiment.stance === "bearish" ? "bg-[color-mix(in_srgb,var(--red)_8%,transparent)]" : "bg-surface"}`}
                    >
                      <span className={`font-bold uppercase ${sentiment.stance === "bullish" ? "text-accent" : sentiment.stance === "bearish" ? "text-red" : "text-muted"}`}>
                        {sentiment.stance}
                      </span>
                      <span className="num text-muted-2"> · score {sentiment.score.toFixed(2)} · </span>
                      {sentiment.summary}
                    </div>
                  )}

                  {newsLoading[item.symbol] && <div className="mt-2 text-xs text-muted-2">Loading headlines…</div>}
                  {news[item.symbol]?.length === 0 && !newsLoading[item.symbol] && (
                    <div className="mt-2 text-xs text-muted-2">No recent headlines found.</div>
                  )}
                  <ul className="mt-2 space-y-1.5">
                    {news[item.symbol]?.map((n) => (
                      <li key={n.link} className="text-xs leading-snug">
                        <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary hover:underline">
                          {n.title}
                        </a>
                        <span className="text-muted-2">
                          {" "}
                          — {n.source}, {n.publishedAt.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-2">
        Prices from Yahoo Finance (may be delayed) · headlines from Google News & Yahoo RSS · sentiment by Claude.
        <br />
        Educational signals, not financial advice — no orders are ever placed automatically.
      </p>
    </main>
  );
}
