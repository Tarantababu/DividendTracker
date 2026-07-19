import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

interface YahooSearch {
  quotes?: Array<{
    symbol: string;
    shortname?: string;
    longname?: string;
    quoteType: string;
    exchDisp?: string;
  }>;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "UPSTREAM", message: `Yahoo search ${res.status}` }, { status: 502 });
    const data = (await res.json()) as YahooSearch;
    const results = (data.quotes ?? [])
      .filter((r) => r.quoteType === "EQUITY" || r.quoteType === "ETF")
      .map((r) => ({
        symbol: r.symbol,
        name: r.longname || r.shortname || r.symbol,
        exchange: r.exchDisp ?? "",
        type: r.quoteType,
      }));
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: "UPSTREAM", message: String(err) }, { status: 502 });
  }
}
