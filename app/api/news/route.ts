import { NextRequest, NextResponse } from "next/server";
import type { NewsItem } from "@/lib/signals";

export const dynamic = "force-dynamic";

const TTL_MS = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

interface CacheEntry {
  at: number;
  items: NewsItem[];
}
const cache: Map<string, CacheEntry> = ((globalThis as Record<string, unknown>).__newsCache ??=
  new Map()) as Map<string, CacheEntry>;

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
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of blocks) {
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

async function fetchRss(url: string, fallbackSource: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return [];
    return parseRss(await res.text(), fallbackSource);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const name = (req.nextUrl.searchParams.get("name") ?? "").trim();
  if (!symbol) return NextResponse.json({ error: "BAD_REQUEST", message: "Pass ?symbol=" }, { status: 400 });

  const key = `${symbol}|${name}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ items: hit.items, cached: true });

  // Company name gives better Google News results than the raw ticker; Yahoo RSS is per-symbol.
  const googleQuery = encodeURIComponent(`"${name || symbol}" stock`);
  const [google, yahoo] = await Promise.all([
    fetchRss(`https://news.google.com/rss/search?q=${googleQuery}&hl=en-US&gl=US&ceid=US:en`, "Google News"),
    fetchRss(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`, "Yahoo Finance"),
  ]);

  const seen = new Set<string>();
  const items = [...yahoo, ...google]
    .filter((i) => {
      const k = i.title.toLowerCase().slice(0, 80);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 12);

  cache.set(key, { at: Date.now(), items });
  return NextResponse.json({ items });
}
