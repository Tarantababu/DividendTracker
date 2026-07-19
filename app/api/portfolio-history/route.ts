import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getPositions, T212Error } from "@/lib/t212";
import { prettyTicker } from "@/lib/analytics";
import { CACHE_DIR } from "@/lib/cacheDir";
import type { Position } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const SYMBOL_MAP_FILE = path.join(CACHE_DIR, "yahoo-symbols.json");
const RESULT_TTL_MS = 10 * 60 * 1000;

export interface DayPoint {
  date: string; // YYYY-MM-DD
  value: number;
  cost: number; // cumulative net invested (cost basis of holdings held that day)
}

export interface Mover {
  t212Ticker: string;
  ticker: string; // pretty
  name: string;
  value: number; // current EUR value
  dayChange: number; // EUR
  dayChangePct: number; // fraction
}

export interface PortfolioHistoryPayload {
  history: DayPoint[];
  today: {
    change: number;
    changePct: number;
    movers: Mover[]; // all holdings, sorted by dayChange desc
    asOf: string;
  };
  unresolved: string[]; // holdings we couldn't map to a Yahoo symbol
  approximate: true; // reconstructed from order history — see UI note
}

interface ChartSeries {
  timestamps: number[];
  closes: (number | null)[];
  currency: string;
  prevClose: number | null;
  price: number | null;
}

const memo = (globalThis as Record<string, unknown>) as {
  __phResult?: { at: number; payload: PortfolioHistoryPayload };
  __phCharts?: Map<string, { at: number; series: ChartSeries }>;
};
memo.__phCharts ??= new Map();

async function loadSymbolMap(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(SYMBOL_MAP_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function saveSymbolMap(map: Record<string, string>) {
  await fs.mkdir(path.dirname(SYMBOL_MAP_FILE), { recursive: true });
  await fs.writeFile(SYMBOL_MAP_FILE, JSON.stringify(map, null, 2), "utf8");
}

/**
 * Resolve a T212 ticker to a Yahoo symbol by trying candidates until one
 * actually returns chart data. Only successful mappings are persisted, so a
 * bad guess never poisons the cache.
 */
async function resolveChart(p: Position, map: Record<string, string>): Promise<{ symbol: string; chart: ChartSeries } | null> {
  const key = p.instrument.ticker;
  const guess = prettyTicker(key);
  const candidates: string[] = [];
  if (map[key]) candidates.push(map[key]);

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(p.instrument.name)}&quotesCount=8&newsCount=0`,
      { headers: { "User-Agent": UA }, cache: "no-store" },
    );
    if (res.ok) {
      const data = (await res.json()) as { quotes?: Array<{ symbol: string; quoteType: string }> };
      const eq = (data.quotes ?? []).filter((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF").map((q) => q.symbol);
      // prefer symbols whose base matches the T212 ticker, then the rest
      candidates.push(...eq.filter((s) => s.split(".")[0] === guess), ...eq.filter((s) => s.split(".")[0] !== guess));
    }
  } catch {
    /* search down — fall through to guesses */
  }
  // last resort: the bare guess and common European exchange suffixes
  candidates.push(guess, `${guess}.DE`, `${guess}.L`, `${guess}.AS`, `${guess}.PA`, `${guess}.MI`);

  const seen = new Set<string>();
  for (const symbol of candidates) {
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const chart = await fetchChart(symbol);
    if (chart && chart.closes.some((c) => c != null)) {
      map[key] = symbol;
      return { symbol, chart };
    }
  }
  delete map[key];
  return null;
}

async function fetchChart(symbol: string): Promise<ChartSeries | null> {
  const hit = memo.__phCharts!.get(symbol);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.series;
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart: {
        result?: Array<{
          timestamp?: number[];
          meta: { currency: string; regularMarketPrice?: number; regularMarketPreviousClose?: number };
          indicators: { quote: Array<{ close: Array<number | null> }> };
        }>;
      };
    };
    const r = data.chart.result?.[0];
    if (!r?.timestamp) return null;
    const series: ChartSeries = {
      timestamps: r.timestamp,
      closes: r.indicators.quote[0]?.close ?? [],
      currency: r.meta.currency,
      prevClose: r.meta.regularMarketPreviousClose ?? null,
      price: r.meta.regularMarketPrice ?? null,
    };
    memo.__phCharts!.set(symbol, { at: Date.now(), series });
    return series;
  } catch {
    return null;
  }
}

/** value of 1 unit of `cur` in EUR per day, aligned by date string; identity for EUR. */
async function fxSeries(cur: string): Promise<Map<string, number> | null> {
  if (cur === "EUR") return null; // identity
  const symbol = `${cur}EUR=X`;
  const chart = await fetchChart(symbol);
  if (!chart) return null;
  const map = new Map<string, number>();
  chart.timestamps.forEach((t, i) => {
    const c = chart.closes[i];
    if (c != null) map.set(new Date(t * 1000).toISOString().slice(0, 10), c);
  });
  return map;
}

const dateOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  if (!force && memo.__phResult && Date.now() - memo.__phResult.at < RESULT_TTL_MS) {
    return NextResponse.json(memo.__phResult.payload);
  }

  let positions: Position[];
  try {
    positions = await getPositions();
  } catch (err) {
    if (err instanceof T212Error) return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "NO_CREDENTIALS" ? 428 : 502 });
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }

  const symbolMap = await loadSymbolMap();
  const mapSizeBefore = Object.keys(symbolMap).length;

  const holdings = await Promise.all(
    positions.map(async (p) => {
      const hit = await resolveChart(p, symbolMap);
      return { p, symbol: hit?.symbol ?? null, chart: hit?.chart ?? null };
    }),
  );
  if (Object.keys(symbolMap).length !== mapSizeBefore) await saveSymbolMap(symbolMap);

  // FX conversion tables for every non-EUR quote currency (GBp = pence → GBP/100)
  const currencies = new Set(
    holdings.flatMap(({ chart }) => (chart && chart.currency !== "EUR" ? [chart.currency === "GBp" ? "GBP" : chart.currency] : [])),
  );
  const fx = new Map<string, Map<string, number>>();
  for (const cur of currencies) {
    const s = await fxSeries(cur);
    if (s) fx.set(cur, s);
  }
  const toEur = (v: number, currency: string, date: string, fallback: Map<string, number> | undefined): number | null => {
    if (currency === "EUR") return v;
    const cur = currency === "GBp" ? "GBP" : currency;
    const scaled = currency === "GBp" ? v / 100 : v;
    const table = fx.get(cur) ?? fallback;
    if (!table) return null;
    // walk back a few days for weekends/holidays
    let d = new Date(date + "T00:00:00Z");
    for (let i = 0; i < 7; i++) {
      const rate = table.get(d.toISOString().slice(0, 10));
      if (rate != null) return scaled * rate;
      d = new Date(d.getTime() - 86400000);
    }
    return null;
  };

  // Union of all trading dates
  const allDates = new Set<string>();
  for (const { chart } of holdings) if (chart) chart.timestamps.forEach((t) => allDates.add(dateOf(t)));
  const dates = [...allDates].sort();

  // Order fills per T212 ticker → lets us reconstruct how many shares were held
  // (and how much cash was invested) on any past day, instead of assuming today's
  // share counts held throughout. Signed: buy +, sell −.
  interface Fill {
    date: string;
    qty: number;
    net: number;
  }
  const fillsByTicker = new Map<string, Fill[]>();
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, "orders.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      items?: Array<{ order: { ticker: string; side: string; status?: string }; fill?: { quantity?: number; filledAt?: string; walletImpact?: { netValue?: number } } }>;
    };
    for (const it of parsed.items ?? []) {
      if (!it.fill?.filledAt) continue;
      const sign = it.order.side === "SELL" ? -1 : 1;
      const arr = fillsByTicker.get(it.order.ticker) ?? [];
      arr.push({ date: it.fill.filledAt.slice(0, 10), qty: sign * (it.fill.quantity ?? 0), net: sign * Math.abs(it.fill.walletImpact?.netValue ?? 0) });
      fillsByTicker.set(it.order.ticker, arr);
    }
    for (const arr of fillsByTicker.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    /* no orders cache → fall back to flat holdings (fractions default to 1) */
  }

  const unresolved: string[] = [];
  const perHolding: { p: Position; values: Map<string, number>; anchor: number; dayChange: number | null; fills: Fill[]; currentQty: number; initialShares: number }[] = [];

  for (const { p, chart } of holdings) {
    if (!chart) {
      unresolved.push(prettyTicker(p.instrument.ticker));
      continue;
    }
    const values = new Map<string, number>();
    let lastClose: number | null = null;
    for (let i = 0; i < chart.timestamps.length; i++) {
      const c = chart.closes[i];
      if (c == null) continue;
      const date = dateOf(chart.timestamps[i]);
      const eur = toEur(c * p.quantity, chart.currency, date, undefined);
      if (eur != null) values.set(date, eur);
      lastClose = c;
    }
    if (values.size === 0) {
      unresolved.push(prettyTicker(p.instrument.ticker));
      continue;
    }
    // Anchor: scale the series so the latest reconstructed point equals T212's EUR value
    const lastDate = [...values.keys()].sort().at(-1)!;
    const reconstructedLast = values.get(lastDate)!;
    const anchor = reconstructedLast > 0 ? p.walletImpact.currentValue / reconstructedLast : 1;

    // Today's change, anchored the same way. Yahoo often omits
    // regularMarketPreviousClose on 1y charts — fall back to the last two closes.
    let dayChange: number | null = null;
    const price = chart.price ?? lastClose;
    const validCloses = chart.closes.filter((c): c is number => c != null);
    const prevClose = chart.prevClose ?? (validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null);
    if (price != null && prevClose != null && prevClose > 0) {
      dayChange = p.walletImpact.currentValue * (1 - prevClose / price);
    }
    // Reconstruct share timeline: shares(t) = initialShares + Σ signed fills up to t.
    // initialShares (pre-order-history holdings) = currentQty − Σ all fills; robust
    // even when the order history doesn't reach back to the first purchase.
    const fills = fillsByTicker.get(p.instrument.ticker) ?? [];
    const totalQty = fills.reduce((a, f) => a + f.qty, 0);
    const initialShares = p.quantity - totalQty;
    perHolding.push({ p, values, anchor, dayChange, fills, currentQty: p.quantity, initialShares });
  }

  // Cost series: net cash invested over time. Work backward from the known current
  // cost basis so the line ends exactly at it. initialCost = cost of pre-history
  // holdings (flat baseline before the first order we have).
  const allFills = perHolding.flatMap((h) => h.fills).sort((a, b) => a.date.localeCompare(b.date));
  const totalCurrentCost = perHolding.reduce((a, h) => a + h.p.walletImpact.totalCost, 0);
  const initialCost = totalCurrentCost - allFills.reduce((a, f) => a + f.net, 0);

  // Portfolio series: value weighted by shares actually held that day; cost accrued
  // from order fills. Two-pointer walks over date-sorted fills keep this O(n).
  const lastKnown = new Map<number, number>();
  const shareState = perHolding.map(() => ({ ptr: 0, running: 0 }));
  let costPtr = 0;
  let costRunning = 0;
  const history: DayPoint[] = [];
  for (const date of dates) {
    while (costPtr < allFills.length && allFills[costPtr].date <= date) costRunning += allFills[costPtr++].net;
    const cost = initialCost + costRunning;

    let total = 0;
    let seen = 0;
    perHolding.forEach((h, idx) => {
      const v = h.values.get(date);
      if (v != null) {
        lastKnown.set(idx, v * h.anchor);
        seen++;
      }
      const st = shareState[idx];
      while (st.ptr < h.fills.length && h.fills[st.ptr].date <= date) st.running += h.fills[st.ptr++].qty;
      const shares = h.initialShares + st.running;
      const frac = h.currentQty > 0 ? Math.max(0, shares / h.currentQty) : 1; // fraction of today's position held then
      total += (lastKnown.get(idx) ?? 0) * frac;
    });
    // skip leading dates where less than half the portfolio has price data yet
    if (seen > 0 && lastKnown.size >= Math.max(1, Math.ceil(perHolding.length / 2))) {
      history.push({ date, value: Math.round(total * 100) / 100, cost: Math.round(Math.max(0, cost) * 100) / 100 });
    }
  }

  const movers: Mover[] = perHolding
    .filter((h) => h.dayChange != null)
    .map((h) => ({
      t212Ticker: h.p.instrument.ticker,
      ticker: prettyTicker(h.p.instrument.ticker),
      name: h.p.instrument.name,
      value: h.p.walletImpact.currentValue,
      dayChange: h.dayChange!,
      dayChangePct: h.p.walletImpact.currentValue - h.dayChange! > 0 ? h.dayChange! / (h.p.walletImpact.currentValue - h.dayChange!) : 0,
    }))
    .sort((a, b) => b.dayChange - a.dayChange);

  const change = movers.reduce((a, m) => a + m.dayChange, 0);
  const totalNow = positions.reduce((a, p) => a + p.walletImpact.currentValue, 0);
  const changePct = totalNow - change > 0 ? change / (totalNow - change) : 0;

  const payload: PortfolioHistoryPayload = {
    history,
    today: { change, changePct, movers, asOf: new Date().toISOString() },
    unresolved,
    approximate: true,
  };
  memo.__phResult = { at: Date.now(), payload };
  return NextResponse.json(payload);
}
