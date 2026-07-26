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
}

interface YahooChart {
  chart: {
    result?: Array<{
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
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => c != null);
    const price = meta?.regularMarketPrice ?? closes.at(-1) ?? null;
    const prev = meta?.previousClose ?? meta?.chartPreviousClose ?? (closes.length >= 2 ? closes[closes.length - 2] : null);
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
    const prev = result?.meta?.previousClose ?? result?.meta?.chartPreviousClose ?? (closes.length >= 2 ? closes[closes.length - 2] : null);
    if (price == null || prev == null || prev === 0) return null;
    return { price, prevClose: prev, changePct: (price - prev) / prev };
  } catch {
    return null;
  }
}
