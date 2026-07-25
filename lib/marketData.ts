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
}

interface YahooChart {
  chart: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; currency?: string };
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
  };
}

/** Spot price + day change for one symbol (index, FX, yield). */
export async function fetchMacroQuote(symbol: string, name: string): Promise<MacroQuote> {
  const empty: MacroQuote = { symbol, name, price: null, changePct: null, currency: null };
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return empty;
    const meta = ((await res.json()) as YahooChart).chart.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? null;
    const prev = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
    return {
      symbol,
      name,
      price,
      changePct: price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null,
      currency: meta?.currency ?? null,
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
