// Shared market-data helpers for the daily digest: RSS news (market-wide and
// per-holding) and lightweight Yahoo quotes for macro indices. Server-only.
import type { NewsItem } from "./signals";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseRss(xml: string, fallbackSource: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1];
    const link = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)?.[1];
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    const source = block.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/)?.[1];
    if (!title || !link) continue;
    items.push({
      title: decodeEntities(title),
      link: link.trim(),
      source: source ? decodeEntities(source) : fallbackSource,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date(0).toISOString(),
    });
  }
  return items;
}

export async function fetchRss(url: string, fallbackSource: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return [];
    return parseRss(await res.text(), fallbackSource);
  } catch {
    return [];
  }
}

const dedupe = (items: NewsItem[], limit: number): NewsItem[] => {
  const seen = new Set<string>();
  return items
    .filter((i) => {
      const k = i.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 70);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
};

const google = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

/** Market-wide headlines across macro themes, newest first. */
export async function fetchMarketNews(limit = 24): Promise<NewsItem[]> {
  const feeds: Array<[string, string]> = [
    ["https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US", "Yahoo Finance"],
    [google("stock market today when:1d"), "Google News"],
    [google("Federal Reserve interest rates inflation when:2d"), "Google News"],
    [google("ECB eurozone inflation economy when:2d"), "Google News"],
    [google("bitcoin crypto market when:1d"), "Google News"],
    [google("dividend ETF investing when:2d"), "Google News"],
  ];
  const all = (await Promise.all(feeds.map(([u, s]) => fetchRss(u, s)))).flat();
  // Drop items with no usable date (feeds sometimes omit pubDate)
  return dedupe(all.filter((i) => i.publishedAt > "1971"), limit);
}

/** Headlines for one holding — company name gives far better hits than the ticker. */
export async function fetchTickerNews(symbol: string, name: string, limit = 4): Promise<NewsItem[]> {
  const [g, y] = await Promise.all([
    fetchRss(google(`"${name || symbol}" when:3d`), "Google News"),
    fetchRss(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`, "Yahoo Finance"),
  ]);
  return dedupe([...y, ...g], limit);
}

export interface MacroQuote {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  currency: string | null;
  // Trend context — lets the digest talk about direction, not just today's tick.
  weekPct: number | null;
  monthPct: number | null;
  quarterPct: number | null;
  yearPct: number | null;
  low52: number | null;
  high52: number | null;
  pctOf52wRange: number | null; // 0 = at the 52w low, 100 = at the high
  vs50dma: number | null; // % above/below the 50-day average
  vs200dma: number | null; // % above/below the 200-day average
  /** Downsampled 1-year closes, for plotting one instrument against another.
   *  Kept small (~60 points) because this rides along in the digest payload. */
  history: { d: string; c: number }[];
}

interface YahooChart {
  chart: {
    result?: Array<{
      timestamp?: number[];
      meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; currency?: string };
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
  };
}

const pctFrom = (closes: number[], daysBack: number, price: number): number | null => {
  const i = closes.length - 1 - daysBack;
  const past = i >= 0 ? closes[i] : closes[0];
  return past != null && past !== 0 ? ((price - past) / past) * 100 : null;
};

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Spot price, day change and trend context for one symbol (index, FX, yield). */
export async function fetchMacroQuote(symbol: string, name: string): Promise<MacroQuote> {
  const empty: MacroQuote = {
    symbol,
    name,
    price: null,
    changePct: null,
    currency: null,
    weekPct: null,
    monthPct: null,
    quarterPct: null,
    yearPct: null,
    low52: null,
    high52: null,
    pctOf52wRange: null,
    vs50dma: null,
    vs200dma: null,
    history: [],
  };
  try {
    // 1y of daily closes gives both today's move and the trend picture in one call.
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return empty;
    const result = ((await res.json()) as YahooChart).chart.result?.[0];
    const meta = result?.meta;
    const rawCloses = result?.indicators?.quote?.[0]?.close ?? [];
    const stamps = result?.timestamp ?? [];
    // Keep dates aligned with closes so two instruments can be plotted together.
    const dated: { d: string; c: number }[] = [];
    for (let i = 0; i < rawCloses.length; i++) {
      const c = rawCloses[i];
      const t = stamps[i];
      if (c != null && t != null) dated.push({ d: new Date(t * 1000).toISOString().slice(0, 10), c });
    }
    const closes = dated.map((x) => x.c);
    const price = meta?.regularMarketPrice ?? closes.at(-1) ?? null;
    // NOT chartPreviousClose — on a 1y range that's the close a YEAR ago, which
    // would report the annual move as today's change. Yesterday's close only.
    const prev = meta?.previousClose ?? (closes.length >= 2 ? closes[closes.length - 2] : null);
    if (price == null) return empty;

    const last50 = closes.slice(-50);
    const last200 = closes.slice(-200);
    const dma50 = mean(last50);
    const dma200 = mean(last200);
    const low52 = closes.length ? Math.min(...closes) : null;
    const high52 = closes.length ? Math.max(...closes) : null;

    return {
      symbol,
      name,
      price,
      changePct: prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null,
      currency: meta?.currency ?? null,
      weekPct: pctFrom(closes, 5, price),
      monthPct: pctFrom(closes, 21, price),
      quarterPct: pctFrom(closes, 63, price),
      yearPct: closes.length ? pctFrom(closes, closes.length - 1, price) : null,
      low52,
      high52,
      pctOf52wRange: low52 != null && high52 != null && high52 > low52 ? ((price - low52) / (high52 - low52)) * 100 : null,
      vs50dma: dma50 ? ((price - dma50) / dma50) * 100 : null,
      vs200dma: dma200 ? ((price - dma200) / dma200) * 100 : null,
      // ~60 evenly spaced points: enough to read a trend, small enough to ship.
      history: dated.filter((_, i) => i % Math.max(1, Math.ceil(dated.length / 60)) === 0 || i === dated.length - 1),
    };
  } catch {
    return empty;
  }
}

export const MACRO_SYMBOLS: Array<{ symbol: string; name: string }> = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^IXIC", name: "Nasdaq" },
  { symbol: "^GDAXI", name: "DAX" },
  { symbol: "^STOXX50E", name: "Euro Stoxx 50" },
  { symbol: "EURUSD=X", name: "EUR/USD" },
  { symbol: "^TNX", name: "US 10Y yield" },
  { symbol: "BTC-EUR", name: "Bitcoin (EUR)" },
  { symbol: "GC=F", name: "Gold" },
  { symbol: "^VIX", name: "VIX (volatility)" },
];

export async function fetchMacro(): Promise<MacroQuote[]> {
  return Promise.all(MACRO_SYMBOLS.map((m) => fetchMacroQuote(m.symbol, m.name)));
}

export interface MarketMover {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number; // %
  exchange: string | null;
  currency: string | null;
}

interface ScreenerQuote {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  marketCap?: number;
  fullExchangeName?: string;
  currency?: string;
}

/**
 * US day gainers/losers from Yahoo's predefined screener, filtered to real
 * large caps so the list reads like the S&P rather than penny-stock noise.
 */
async function fetchUsMovers(direction: "day_gainers" | "day_losers", minMarketCap = 5e9, limit = 5): Promise<MarketMover[]> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${direction}&count=50`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const quotes = (((await res.json()) as { finance?: { result?: Array<{ quotes?: ScreenerQuote[] }> } }).finance?.result?.[0]?.quotes ?? []) as ScreenerQuote[];
    return quotes
      .filter((q) => q.symbol && typeof q.regularMarketChangePercent === "number" && (q.marketCap ?? 0) >= minMarketCap)
      .slice(0, limit)
      .map((q) => ({
        symbol: q.symbol!,
        name: q.shortName || q.longName || q.symbol!,
        price: q.regularMarketPrice ?? null,
        changePct: q.regularMarketChangePercent!,
        exchange: q.fullExchangeName ?? null,
        currency: q.currency ?? null,
      }));
  } catch {
    return [];
  }
}

// Yahoo's predefined screeners are US-only (the region param is ignored), so the
// European board is computed from a curated large-cap universe instead.
const EU_UNIVERSE: Array<[string, string]> = [
  ["SAP.DE", "SAP"], ["SIE.DE", "Siemens"], ["ALV.DE", "Allianz"], ["DTE.DE", "Deutsche Telekom"], ["AIR.DE", "Airbus"],
  ["MBG.DE", "Mercedes-Benz"], ["BMW.DE", "BMW"], ["VOW3.DE", "Volkswagen"], ["BAS.DE", "BASF"], ["BAYN.DE", "Bayer"],
  ["MUV2.DE", "Munich Re"], ["DBK.DE", "Deutsche Bank"], ["RHM.DE", "Rheinmetall"], ["IFX.DE", "Infineon"], ["ADS.DE", "Adidas"],
  ["ASML.AS", "ASML"], ["INGA.AS", "ING"], ["AD.AS", "Ahold Delhaize"], ["PHIA.AS", "Philips"],
  ["MC.PA", "LVMH"], ["OR.PA", "L'Oréal"], ["TTE.PA", "TotalEnergies"], ["SAN.PA", "Sanofi"], ["AIR.PA", "Airbus (Paris)"],
  ["BNP.PA", "BNP Paribas"], ["SU.PA", "Schneider Electric"], ["RMS.PA", "Hermès"],
  ["ISP.MI", "Intesa Sanpaolo"], ["ENI.MI", "Eni"], ["ENEL.MI", "Enel"],
  ["SAN.MC", "Banco Santander"], ["IBE.MC", "Iberdrola"], ["ITX.MC", "Inditex"],
  ["NESN.SW", "Nestlé"], ["NOVN.SW", "Novartis"], ["ROG.SW", "Roche"],
  ["SHEL.L", "Shell"], ["AZN.L", "AstraZeneca"], ["HSBA.L", "HSBC"], ["ULVR.L", "Unilever"],
];

/** European large-cap gainers/losers for the day, from the curated universe. */
export async function fetchEuropeMovers(limit = 5): Promise<{ gainers: MarketMover[]; losers: MarketMover[] }> {
  const results: (MarketMover | null)[] = await Promise.all(
    EU_UNIVERSE.map(async ([symbol, name]) => {
      const mv = await fetchDayMove(symbol);
      if (!mv) return null;
      return { symbol, name, price: mv.price, changePct: mv.changePct * 100, exchange: symbol.split(".")[1] ?? null, currency: null };
    }),
  );
  const ok = results.filter((r): r is MarketMover => r != null).sort((a, b) => b.changePct - a.changePct);
  return { gainers: ok.slice(0, limit), losers: [...ok].reverse().slice(0, limit) };
}

export interface MarketMovers {
  usGainers: MarketMover[];
  usLosers: MarketMover[];
  euGainers: MarketMover[];
  euLosers: MarketMover[];
}

/** Day gainers/losers across US large caps and European large caps. */
export async function fetchMarketMovers(): Promise<MarketMovers> {
  const [usGainers, usLosers, eu] = await Promise.all([fetchUsMovers("day_gainers"), fetchUsMovers("day_losers"), fetchEuropeMovers()]);
  return { usGainers, usLosers, euGainers: eu.gainers, euLosers: eu.losers };
}

/** Resolve a promise to `fallback` if it takes longer than `ms`. Keeps one slow
 *  upstream from blowing the whole serverless invocation's time budget. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export interface DayMove {
  price: number;
  prevClose: number;
  changePct: number; // fraction
}

/**
 * Today's % move for one symbol from a short chart — far cheaper than the full
 * portfolio-history reconstruction when all we need is the day's change.
 */
export async function fetchDayMove(symbol: string): Promise<DayMove | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const result = ((await res.json()) as YahooChart).chart.result?.[0];
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => c != null);
    const price = result?.meta?.regularMarketPrice ?? closes.at(-1) ?? null;
    // Same trap as above: chartPreviousClose is the close before the whole range.
    const prev = result?.meta?.previousClose ?? (closes.length >= 2 ? closes[closes.length - 2] : null);
    if (price == null || prev == null || prev === 0) return null;
    return { price, prevClose: prev, changePct: (price - prev) / prev };
  } catch {
    return null;
  }
}
