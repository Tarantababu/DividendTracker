import { NextRequest, NextResponse } from "next/server";
import { buildInsights, rsi, sma, type Quote } from "@/lib/signals";

export const dynamic = "force-dynamic";

const TTL_MS = 5 * 60 * 1000;
const MAX_SYMBOLS = 60;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

interface CacheEntry {
  at: number;
  quote: Quote;
}

// Survives across requests in the dev server process; cheap enough to lose on restart.
const cache: Map<string, CacheEntry> = ((globalThis as Record<string, unknown>).__quoteCache ??=
  new Map()) as Map<string, CacheEntry>;

interface YahooChart {
  chart: {
    result?: Array<{
      meta: {
        currency: string;
        symbol: string;
        longName?: string;
        shortName?: string;
        regularMarketPrice: number;
        regularMarketPreviousClose?: number;
        previousClose?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
      };
      indicators: { quote: Array<{ close: Array<number | null> }> };
    }>;
    error?: { code: string; description: string } | null;
  };
}

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.quote;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as YahooChart;
  const result = data.chart.result?.[0];
  if (!result) return null;

  const closes = (result.indicators.quote[0]?.close ?? []).filter((c): c is number => c != null);
  if (closes.length === 0) return null;
  const meta = result.meta;
  const price = meta.regularMarketPrice ?? closes[closes.length - 1];
  // NOT meta.chartPreviousClose — that's the close before the chart range (a year ago here)
  const prevClose = meta.regularMarketPreviousClose ?? meta.previousClose ?? closes[closes.length - 2] ?? price;

  const quote: Quote = {
    symbol: meta.symbol,
    name: meta.longName || meta.shortName || meta.symbol,
    currency: meta.currency,
    price,
    prevClose,
    changePct: prevClose > 0 ? price / prevClose - 1 : 0,
    rsi14: rsi(closes),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    high52w: meta.fiftyTwoWeekHigh ?? Math.max(...closes),
    low52w: meta.fiftyTwoWeekLow ?? Math.min(...closes),
    spark: closes.slice(-90),
    insights: buildInsights(closes, price),
    updatedAt: new Date().toISOString(),
  };
  cache.set(symbol, { at: Date.now(), quote });
  return quote;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) {
    return NextResponse.json({ error: "BAD_REQUEST", message: "Pass ?symbols=AAPL,ALV.DE" }, { status: 400 });
  }

  try {
    const settled = await Promise.allSettled(symbols.map(fetchQuote));
    const quotes: Quote[] = [];
    const failed: string[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) quotes.push(r.value);
      else failed.push(symbols[i]);
    });
    return NextResponse.json({ quotes, failed });
  } catch (err) {
    return NextResponse.json({ error: "UPSTREAM", message: String(err) }, { status: 502 });
  }
}
