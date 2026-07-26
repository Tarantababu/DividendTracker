import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAccountSummary, getPies, getPositions, syncDividends, T212Error } from "@/lib/t212";
import { prettyTicker } from "@/lib/analytics";
import { fetchMacro, fetchMarketNews, fetchTickerNews, type MacroQuote } from "@/lib/marketData";
import type { NewsItem } from "@/lib/signals";
import type { Mover, PortfolioHistoryPayload } from "@/app/api/portfolio-history/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One digest per day is enough — it's a daily read, and the AI call is the
// expensive part. Cached in module memory keyed by date + a fresh=1 escape hatch.
interface Cached {
  at: number;
  payload: DigestPayload;
}
const store = globalThis as Record<string, unknown>;

export interface DigestSection {
  heading: string;
  body: string; // markdown-ish plain text (bold + bullets only)
  links?: NewsItem[];
}

export interface MoverNote {
  ticker: string;
  name: string;
  value: number;
  dayChange: number;
  dayChangePct: number;
  why: string; // AI explanation grounded in the headlines
  links: NewsItem[];
}

export interface LearnTopic {
  concept: string; // e.g. "The yield curve"
  explain: string; // plain-English explanation
  today: string; // how it connects to today's data
  readMore: { title: string; url: string }[];
}

export interface DigestPayload {
  date: string;
  currency: string;
  generatedAt: string;
  headline: string; // one-line take on the day
  mood: "risk-on" | "risk-off" | "mixed" | "quiet";
  education: LearnTopic[]; // daily macro lesson tied to what actually happened
  portfolio: {
    totalValue: number;
    dayChange: number | null;
    dayChangePct: number | null;
    netDeposits: number | null;
    totalReturn: number | null;
    cash: number;
    dividendsToday: { ticker: string; amount: number }[];
    dividendsThisWeek: number;
  };
  macro: MacroQuote[];
  gainers: MoverNote[];
  losers: MoverNote[];
  sections: DigestSection[]; // macro picture, what it means for you, watch list, etc.
  news: NewsItem[]; // raw reference list
  aiAvailable: boolean;
  note?: string;
}

const SYSTEM = `You are a sharp financial analyst writing a DAILY DIGEST for one retail investor. They hold a dividend-ETF portfolio on Trading212, live in Germany, and are working toward FIRE. You get their real portfolio numbers, today's market data, and today's headlines.

Your job: explain what happened today on BOTH scales — macro (world/markets) and micro (their actual holdings) — and what it MEANS for them specifically. Be concrete and grounded ONLY in the data given. Never invent numbers, prices or events. If the data is thin, say so plainly.

This investor wants to LEARN macro every day, not just be told numbers. Lean into the macro side: explain mechanisms and trends, always in plain English, always tied to the actual data given.

Return ONLY valid JSON (no markdown fence) shaped exactly:
{
  "headline": "one punchy sentence (<=110 chars) summarising the day for this investor",
  "mood": "risk-on" | "risk-off" | "mixed" | "quiet",
  "moverNotes": [ { "ticker": "AAPL", "why": "1-2 sentences: the most likely driver, tied to a headline or macro move given. Say 'no clear news — likely sector/market drift' when nothing explains it." } ],
  "education": [
    {
      "concept": "Short name of a macro concept that TODAY's data illustrates (e.g. 'Real yields', 'The dollar smile', 'Breadth vs the index')",
      "explain": "3-5 sentences teaching the concept from first principles, plain English, no jargon without defining it. Assume a smart beginner.",
      "today": "2-3 sentences connecting it to today's exact numbers/trends given, so the lesson sticks.",
      "readMore": [ { "title": "Specific, real, stable reference page (Investopedia, FRED, ECB/Fed explainer, Wikipedia)", "url": "https://..." } ]
    }
  ],
  "sections": [
    { "heading": "Macro picture", "body": "..." },
    { "heading": "Trends & regime", "body": "..." },
    { "heading": "What moved your portfolio", "body": "..." },
    { "heading": "What it means for you", "body": "..." },
    { "heading": "Dividends & income", "body": "..." },
    { "heading": "Watch tomorrow", "body": "..." }
  ]
}

"education": give 2-3 topics. Pick concepts the day's data genuinely demonstrates (rates vs growth stocks, yield-curve moves, DXY/EUR strength, VIX regimes, gold as a real-rate hedge, breadth, sector rotation, covered-call NAV erosion, dividend vs total return, currency drag for a EUR investor…). Vary them day to day. Only use readMore URLs you are confident exist and are stable — prefer investopedia.com/terms/..., fred.stlouisfed.org, ecb.europa.eu, federalreserve.gov, en.wikipedia.org. 1-2 links each. Never invent a URL that looks plausible but you are unsure about; fewer links is better than a broken one.

Rules for "body": plain text with "- " bullets and **bold** for emphasis. No headings, no tables, no links (links are attached separately), no code. 3-6 bullets each, each bullet a full, specific thought with the actual number from the data. Keep every section tight and readable.
- "Macro picture": what indices/rates/FX/crypto did today and WHY (per the headlines). Go deeper than the numbers: for each major move, name the transmission mechanism (why higher yields hit long-duration growth stocks, why a stronger dollar pressures commodities, etc.) so the reader learns the plumbing. 5-6 bullets here — this is the section they read to learn.
- "Trends & regime": zoom out using the 1w/1m/3m/1y changes, 52-week range position and 50/200-day averages provided. Is each market in an uptrend, downtrend or range? Any divergences (e.g. Europe outperforming the US, gold up with yields)? What macro regime does the combination suggest, and what typically drives that regime? Reference the actual trend numbers.
- "What moved your portfolio": their biggest euro movers and the driver, referencing tickers.
- "What it means for you": the practical read for a long-horizon dividend/FIRE investor — is this noise or signal, does it change anything, what NOT to do. Be honest when the answer is "nothing to do".
- "Dividends & income": today's/this week's payments, income trajectory, anything notable.
- "Watch tomorrow": specific, checkable things (data releases, ex-dividend dates, levels) drawn from the data/headlines.
Include one moverNotes entry for EVERY ticker listed under GAINERS and LOSERS in the input, using its exact ticker string.
End the "What it means for you" body with a final bullet: "- **Not financial advice** — this is your own data, summarised."`;

function buildContext(d: {
  summary: Awaited<ReturnType<typeof getAccountSummary>>;
  positions: Awaited<ReturnType<typeof getPositions>>;
  pies: Awaited<ReturnType<typeof getPies>>;
  macro: MacroQuote[];
  news: NewsItem[];
  gainers: Mover[];
  losers: Mover[];
  moverNews: Map<string, NewsItem[]>;
  dayChange: number | null;
  dayChangePct: number | null;
  divToday: { ticker: string; amount: number }[];
  divWeek: number;
  netDeposits: number | null;
}): string {
  const cur = d.summary.currency ?? "EUR";
  const lines: string[] = [];
  lines.push(`DATE: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(
    `PORTFOLIO: total value ${cur}${d.summary.totalValue.toFixed(0)}; today ${d.dayChange != null ? `${d.dayChange >= 0 ? "+" : ""}${cur}${d.dayChange.toFixed(0)} (${((d.dayChangePct ?? 0) * 100).toFixed(2)}%)` : "unknown"}; cash ${cur}${(d.summary.cash.availableToTrade + d.summary.cash.inPies).toFixed(0)}; ${d.positions.length} holdings` +
      (d.netDeposits != null ? `; net deposits ${cur}${d.netDeposits.toFixed(0)}; total return ${cur}${(d.summary.totalValue - d.netDeposits).toFixed(0)}` : ""),
  );
  lines.push(`CATEGORIES (Trading212 pies): ${d.pies.map((p) => `${p.name} value ${cur}${p.value.toFixed(0)} / invested ${cur}${(p.netDeposits ?? p.invested).toFixed(0)}`).join("; ") || "none"}`);
  lines.push(`MACRO TODAY: ${d.macro.map((m) => `${m.name} ${m.price != null ? m.price.toFixed(2) : "n/a"}${m.changePct != null ? ` (${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(2)}%)` : ""}`).join("; ")}`);
  lines.push("");
  lines.push("MACRO TRENDS (for the 'Trends & regime' section and the lesson):");
  const pc = (v: number | null) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  for (const m of d.macro) {
    lines.push(
      `  ${m.name}: 1w ${pc(m.weekPct)}, 1m ${pc(m.monthPct)}, 3m ${pc(m.quarterPct)}, 1y ${pc(m.yearPct)}` +
        `${m.pctOf52wRange != null ? `, at ${m.pctOf52wRange.toFixed(0)}% of its 52w range (${m.low52?.toFixed(2)}–${m.high52?.toFixed(2)})` : ""}` +
        `${m.vs50dma != null ? `, ${pc(m.vs50dma)} vs 50dma` : ""}${m.vs200dma != null ? `, ${pc(m.vs200dma)} vs 200dma` : ""}`,
    );
  }
  lines.push(
    `GAINERS: ${d.gainers.map((m) => `${m.ticker} (${m.name}) +${cur}${m.dayChange.toFixed(0)} (${(m.dayChangePct * 100).toFixed(2)}%), value ${cur}${m.value.toFixed(0)}`).join("; ") || "none"}`,
  );
  lines.push(
    `LOSERS: ${d.losers.map((m) => `${m.ticker} (${m.name}) ${cur}${m.dayChange.toFixed(0)} (${(m.dayChangePct * 100).toFixed(2)}%), value ${cur}${m.value.toFixed(0)}`).join("; ") || "none"}`,
  );
  lines.push(`DIVIDENDS TODAY: ${d.divToday.length ? d.divToday.map((x) => `${x.ticker} ${cur}${x.amount.toFixed(2)}`).join("; ") : "none"}; last 7 days total ${cur}${d.divWeek.toFixed(2)}`);
  lines.push("");
  lines.push("HEADLINES PER MOVER:");
  for (const [ticker, items] of d.moverNews) {
    if (items.length) lines.push(`  ${ticker}: ${items.map((i) => `"${i.title}" (${i.source})`).join(" | ")}`);
    else lines.push(`  ${ticker}: no recent headlines found`);
  }
  lines.push("");
  lines.push("MARKET HEADLINES TODAY:");
  d.news.slice(0, 22).forEach((n, i) => lines.push(`  ${i + 1}. "${n.title}" — ${n.source} (${n.publishedAt.slice(0, 10)})`));
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const today = new Date().toISOString().slice(0, 10);
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const key = `__digest_${today}`;
  const hit = store[key] as Cached | undefined;
  if (!fresh && hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return NextResponse.json(hit.payload);

  try {
    // Portfolio + market data in parallel. Movers come from the reconstruction
    // route via an internal call-free import path: we recompute from its payload.
    const origin = req.nextUrl.origin;
    const [summary, positions, pies, dividends, macro, news, histRes] = await Promise.all([
      getAccountSummary(),
      getPositions(),
      getPies().catch(() => []),
      syncDividends(false).catch(() => ({ items: [] as Awaited<ReturnType<typeof syncDividends>>["items"] })),
      fetchMacro(),
      fetchMarketNews(),
      fetch(`${origin}/api/portfolio-history`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<PortfolioHistoryPayload>) : null))
        .catch(() => null),
    ]);

    const movers = histRes?.today.movers ?? [];
    const gainers = movers.filter((m) => m.dayChange > 0).slice(0, 5);
    const losers = [...movers.filter((m) => m.dayChange < 0)].sort((a, b) => a.dayChange - b.dayChange).slice(0, 5);

    // Headlines for the movers we're going to explain
    const focus = [...gainers, ...losers];
    const moverNews = new Map<string, NewsItem[]>();
    const fetched = await Promise.all(focus.map((m) => fetchTickerNews(m.ticker, m.name, 4)));
    focus.forEach((m, i) => moverNews.set(m.ticker, fetched[i]));

    const divItems = dividends.items ?? [];
    const divToday = divItems
      .filter((x) => x.paidOn.slice(0, 10) === today)
      .map((x) => ({ ticker: prettyTicker(x.ticker), amount: x.amount }));
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const divWeek = divItems.filter((x) => x.paidOn.slice(0, 10) >= weekAgo).reduce((s, x) => s + x.amount, 0);

    // Account-level net deposits (deposits − withdrawals), same source the dashboard
    // uses — summing pie deposits would omit cash and realised P/L and disagree with it.
    const netDeposits = await fetch(`${origin}/api/fire`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ netContributions?: number }>) : null))
      .then((j) => (typeof j?.netContributions === "number" ? j.netContributions : null))
      .catch(() => null);

    const base: DigestPayload = {
      date: today,
      currency: summary.currency ?? "EUR",
      generatedAt: new Date().toISOString(),
      headline: "",
      mood: "quiet",
      education: [],
      portfolio: {
        totalValue: summary.totalValue,
        dayChange: histRes?.today.change ?? null,
        dayChangePct: histRes?.today.changePct ?? null,
        netDeposits,
        totalReturn: netDeposits != null ? summary.totalValue - netDeposits : null,
        cash: summary.cash.availableToTrade + summary.cash.inPies,
        dividendsToday: divToday,
        dividendsThisWeek: divWeek,
      },
      macro,
      gainers: gainers.map((m) => ({ ...m, why: "", links: moverNews.get(m.ticker) ?? [] })),
      losers: losers.map((m) => ({ ...m, why: "", links: moverNews.get(m.ticker) ?? [] })),
      sections: [],
      news,
      aiAvailable: !!process.env.ANTHROPIC_API_KEY,
    };

    if (!process.env.ANTHROPIC_API_KEY) {
      base.headline = "Add ANTHROPIC_API_KEY to .env.local for the AI commentary — raw market data below.";
      base.note = "AI commentary unavailable (no ANTHROPIC_API_KEY).";
      store[key] = { at: Date.now(), payload: base } satisfies Cached;
      return NextResponse.json(base);
    }

    const context = buildContext({
      summary,
      positions,
      pies,
      macro,
      news,
      gainers,
      losers,
      moverNews,
      dayChange: histRes?.today.change ?? null,
      dayChangePct: histRes?.today.changePct ?? null,
      divToday,
      divWeek,
      netDeposits,
    });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Today's data:\n\n${context}\n\nWrite the digest JSON now.` }],
    });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");

    try {
      const parsed = JSON.parse(json) as {
        headline?: string;
        mood?: DigestPayload["mood"];
        moverNotes?: { ticker: string; why: string }[];
        sections?: DigestSection[];
        education?: LearnTopic[];
      };
      const whyBy = new Map((parsed.moverNotes ?? []).map((n) => [n.ticker, n.why]));
      base.headline = parsed.headline?.trim() || "Your daily portfolio and market digest.";
      base.mood = parsed.mood ?? "mixed";
      base.sections = (parsed.sections ?? []).filter((s) => s?.heading && s?.body);
      base.education = (parsed.education ?? [])
        .filter((t) => t?.concept && t?.explain)
        .map((t) => ({ ...t, readMore: (t.readMore ?? []).filter((r) => r?.url?.startsWith("https://")) }));
      base.gainers = base.gainers.map((g) => ({ ...g, why: whyBy.get(g.ticker) ?? "" }));
      base.losers = base.losers.map((l) => ({ ...l, why: whyBy.get(l.ticker) ?? "" }));
    } catch {
      base.headline = "Digest generated, but the AI response couldn't be parsed — raw data below.";
      base.note = "AI returned an unexpected format.";
    }

    store[key] = { at: Date.now(), payload: base } satisfies Cached;
    return NextResponse.json(base);
  } catch (err) {
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
