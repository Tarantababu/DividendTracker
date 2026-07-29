import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAccountSummary, getPies, getPositions, syncDividends, T212Error } from "@/lib/t212";
import { prettyTicker } from "@/lib/analytics";
import { fetchDayMove, fetchMacro, fetchMarketMovers, fetchMarketNews, fetchTickerNews, withTimeout, type MacroQuote, type MarketMovers } from "@/lib/marketData";
import { resolveSymbol } from "@/lib/yahooFund";
import { contributionStats, externalCashflows } from "@/lib/fire";
import { syncTransactions } from "@/lib/t212";
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

export interface StoryChart {
  title: string;
  symbols: string[]; // macro symbols to overlay, e.g. ["^TNX", "^IXIC"]
  caption: string; // what the reader should notice, and why it matters
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
  /** The lead narrative: today told as one connected story — what happened, why,
   *  how it reached this portfolio, and what to expect. Paragraphs, not bullets. */
  story: string[];
  /** Relationships the story argued, plotted so they can be seen rather than
   *  asserted. Series are rebased to 100 at the start so instruments on wildly
   *  different scales (a yield vs an index) are comparable on one axis. */
  storyCharts: StoryChart[];
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
  marketMovers: MarketMovers; // biggest movers in the wider US/EU market, not just holdings
  gainers: MoverNote[];
  losers: MoverNote[];
  sections: DigestSection[]; // macro picture, what it means for you, watch list, etc.
  news: NewsItem[]; // raw reference list
  aiAvailable: boolean;
  note?: string;
}

/**
 * Best-effort parse of a possibly-truncated JSON object. A long generation that
 * gets cut off still contains most of the digest, so rather than throwing it away
 * we close the open brackets and keep whatever parsed cleanly.
 */
function salvageJson(raw: string): Record<string, unknown> | null {
  const t = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    /* truncated — repair below */
  }
  // Walk the text tracking string/escape state so we only cut at structural points.
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  const safeEnds: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      stack.pop();
      safeEnds.push(i); // end of a complete nested value
    }
  }
  // Try progressively earlier complete values, closing whatever is still open.
  for (let k = safeEnds.length - 1; k >= 0; k--) {
    const end = safeEnds[k];
    const slice = t.slice(0, end + 1);
    const open: string[] = [];
    let s = false;
    let e = false;
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      if (s) {
        if (e) e = false;
        else if (c === "\\") e = true;
        else if (c === '"') s = false;
        continue;
      }
      if (c === '"') s = true;
      else if (c === "{") open.push("}");
      else if (c === "[") open.push("]");
      else if (c === "}" || c === "]") open.pop();
    }
    // Drop a dangling comma before closing, else JSON.parse rejects it.
    const cleaned = slice.replace(/,\s*$/, "");
    try {
      return JSON.parse(cleaned + open.reverse().join("")) as Record<string, unknown>;
    } catch {
      /* step back to an earlier boundary */
    }
  }
  return null;
}

const SYSTEM = `You are a sharp financial analyst writing a DAILY DIGEST for one retail investor. They hold a dividend-ETF portfolio on Trading212, live in Germany, and are working toward FIRE. You get their real portfolio numbers, today's market data, and today's headlines.

Your job: explain what happened today on BOTH scales — macro (world/markets) and micro (their actual holdings) — and what it MEANS for them specifically. Be concrete and grounded ONLY in the data given. Never invent numbers, prices or events. If the data is thin, say so plainly.

This investor wants to LEARN macro every day, not just be told numbers. Lean into the macro side: explain mechanisms and trends, always in plain English, always tied to the actual data given.

Return ONLY valid JSON (no markdown fence). Emit the keys in EXACTLY this order — headline, mood, story, sections, moverNotes, education — so the most important content is written first:
{
  "headline": "one punchy sentence (<=110 chars) summarising the day for this investor",
  "mood": "risk-on" | "risk-off" | "mixed" | "quiet",
  "story": ["paragraph", "paragraph", "..."],
  "storyCharts": [ { "title": "...", "symbols": ["^TNX", "^IXIC"], "caption": "..." } ],
  "sections": [ /* see below */ ],
  "moverNotes": [ { "ticker": "AAPL", "why": "1-2 sentences: the most likely driver, tied to a headline or macro move given. Say 'no clear news — likely sector/market drift' when nothing explains it." } ],
  "education": [
    {
      "concept": "Short name of a macro concept that TODAY's data illustrates (e.g. 'Real yields', 'The dollar smile', 'Breadth vs the index')",
      "explain": "3-5 sentences teaching the concept from first principles, plain English, no jargon without defining it. Assume a smart beginner.",
      "today": "2-3 sentences connecting it to today's exact numbers/trends given, so the lesson sticks.",
      "readMore": [ { "title": "Specific, real, stable reference page (Investopedia, FRED, ECB/Fed explainer, Wikipedia)", "url": "https://..." } ]
    }
  ]
}

"story" — THE STORY OF THE DAY. This is the lead the investor reads first, and often the only thing they read. Write 4-6 flowing paragraphs (roughly 55-90 words each) as ONE connected narrative, not a list of facts. Rules:
- Prose only. No bullets, no headings, no bold, no emoji. Plain sentences a smart friend would say out loud.
- Follow a causal chain and make every link explicit — this is a story, so it needs "because", "which meant", "so": what happened → WHY it happened (the driver in the headlines) → HOW it transmitted through markets (the actual mechanism: discounting, the dollar, risk appetite, sector rotation) → what it did to THIS portfolio and its categories → what to expect next and what would confirm or break that expectation.
- Cover all four layers and connect them: macro (indices, rates, FX, crypto), news (the specific stories driving it), trends (where this sits in the 1w/1m/3m/1y picture and the 52-week range — is today noise or continuation?), and micro (their movers, dividends, categories).
- Teach while narrating. When you use a term (duration, real yields, breadth, rotation), define it in half a sentence inline so the reader ends the piece understanding something they didn't before.
- Be honest about uncertainty: distinguish what the data shows from what is a plausible read, and say when a move has no clear explanation. Never invent a cause.
- End the final paragraph on what to watch next and why it matters to a long-horizon dividend investor. No advice to buy or sell.
- Every number must come from the data given.

"storyCharts" — 2 or 3 charts that SHOW a relationship the story just argued, so the reader can see it rather than take your word for it. Rules:
- Pick pairs (occasionally three) whose interaction you actually explained: a yield against a growth index, the dollar against gold or crypto, one region against another, volatility against equities.
- "symbols" must be drawn ONLY from the symbols listed in MACRO TODAY. Use the exact symbol strings. Two per chart is usually clearest.
- "title" names the relationship in a few words ("US 10-year yield vs Nasdaq").
- "caption" is one or two sentences: what to look for in the lines, and what it implies for a dividend investor. Say plainly when the relationship broke down or is weak today — a chart that contradicts the usual story is worth showing and explaining.
- Both series are rebased to 100 over the last year before plotting, so the reader compares SHAPE, not level. Write captions accordingly (talk about moving together or diverging, not about crossing).

The "sections" array is exactly these six, in order:
    { "heading": "Macro picture", "body": "..." },
    { "heading": "Trends & regime", "body": "..." },
    { "heading": "What moved your portfolio", "body": "..." },
    { "heading": "What it means for you", "body": "..." },
    { "heading": "Dividends & income", "body": "..." },
    { "heading": "Watch tomorrow", "body": "..." }

"education": give 2-3 topics. Pick concepts the day's data genuinely demonstrates (rates vs growth stocks, yield-curve moves, DXY/EUR strength, VIX regimes, gold as a real-rate hedge, breadth, sector rotation, covered-call NAV erosion, dividend vs total return, currency drag for a EUR investor…). Vary them day to day. Only use readMore URLs you are confident exist and are stable — prefer investopedia.com/terms/..., fred.stlouisfed.org, ecb.europa.eu, federalreserve.gov, en.wikipedia.org. 1-2 links each. Never invent a URL that looks plausible but you are unsure about; fewer links is better than a broken one.

Rules for "body": plain text with "- " bullets and **bold** for emphasis. No headings, no tables, no links (links are attached separately), no code. 3-6 bullets each, each bullet a full, specific thought with the actual number from the data. Keep every section tight and readable.
- "Macro picture": what indices/rates/FX/crypto did today and WHY (per the headlines). Go deeper than the numbers: for each major move, name the transmission mechanism (why higher yields hit long-duration growth stocks, why a stronger dollar pressures commodities, etc.) so the reader learns the plumbing. 5-6 bullets here — this is the section they read to learn.
- Use the WIDER MARKET MOVERS list (big US/European names the investor does NOT own) in "Macro picture" for sector colour — e.g. what the day's biggest large-cap moves say about which sectors led or lagged, and whether that theme touches their holdings. Never imply they own these names.
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
  marketMovers: MarketMovers;
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
  const mm = d.marketMovers;
  const fmtMM = (arr: MarketMovers["usGainers"]) => arr.map((m) => `${m.name} (${m.symbol}) ${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(1)}%`).join("; ") || "none";
  lines.push("");
  lines.push("WIDER MARKET MOVERS (large caps, NOT held by this investor — use for market colour and sector read):");
  lines.push(`  US gainers: ${fmtMM(mm.usGainers)}`);
  lines.push(`  US losers: ${fmtMM(mm.usLosers)}`);
  lines.push(`  Europe gainers: ${fmtMM(mm.euGainers)}`);
  lines.push(`  Europe losers: ${fmtMM(mm.euLosers)}`);
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
    // Everything in parallel, each with its own timeout so one slow upstream can't
    // eat the whole serverless budget (a 502 is worse than a digest missing a part).
    const origin = req.nextUrl.origin;
    const [summary, positions, pies, dividends, macro, news, marketMovers, histRes] = await Promise.all([
      getAccountSummary(),
      getPositions(),
      withTimeout(getPies(), 30_000, [] as Awaited<ReturnType<typeof getPies>>),
      withTimeout(syncDividends(false), 40_000, { items: [], lastSync: null } as Awaited<ReturnType<typeof syncDividends>>),
      withTimeout(fetchMacro(), 25_000, [] as MacroQuote[]),
      withTimeout(fetchMarketNews(), 20_000, []),
      withTimeout(fetchMarketMovers(), 30_000, { usGainers: [], usLosers: [], euGainers: [], euLosers: [] } as MarketMovers),
      // The reconstruction is the heaviest dependency (it syncs the full order
      // history on a cold instance). Give it a hard ceiling; without it we simply
      // report no movers rather than failing the whole digest.
      withTimeout(
        fetch(`${origin}/api/portfolio-history`, { cache: "no-store" })
          .then((r) => (r.ok ? (r.json() as Promise<PortfolioHistoryPayload>) : null))
          .catch(() => null),
        70_000,
        null as PortfolioHistoryPayload | null,
      ),
    ]);

    // Prefer the reconstruction's movers; if it timed out, derive them directly from
    // short Yahoo charts (much cheaper) so the digest still has its movers section.
    let movers: Mover[] = histRes?.today.movers ?? [];
    let fallbackDayChange: number | null = null;
    if (movers.length === 0 && positions.length > 0) {
      const moves = await withTimeout(
        Promise.all(
          positions.map(async (p) => {
            const guess = prettyTicker(p.instrument.ticker);
            const symbol = await resolveSymbol(p.instrument.name, guess);
            const mv = (await fetchDayMove(symbol)) ?? (await fetchDayMove(guess));
            if (!mv) return null;
            const value = p.walletImpact.currentValue;
            return {
              t212Ticker: p.instrument.ticker,
              ticker: guess,
              name: p.instrument.name,
              value,
              dayChange: value * (mv.changePct / (1 + mv.changePct)), // value is post-move
              dayChangePct: mv.changePct,
            } satisfies Mover;
          }),
        ),
        45_000,
        [] as (Mover | null)[],
      );
      movers = moves.filter((m): m is Mover => m != null).sort((a, b) => b.dayChange - a.dayChange);
      if (movers.length) fallbackDayChange = movers.reduce((s, m) => s + m.dayChange, 0);
    }
    const gainers = movers.filter((m) => m.dayChange > 0).slice(0, 5);
    const losers = [...movers.filter((m) => m.dayChange < 0)].sort((a, b) => a.dayChange - b.dayChange).slice(0, 5);

    // Second phase: mover headlines and net deposits together, both bounded. Running
    // them in parallel keeps the worst case within the platform's function limit.
    const focus = [...gainers, ...losers];
    const moverNews = new Map<string, NewsItem[]>();
    const [fetched, netDepositsResult] = await Promise.all([
      withTimeout(
        Promise.all(focus.map((m) => fetchTickerNews(m.ticker, m.name, 4))),
        25_000,
        focus.map(() => [] as NewsItem[]),
      ),
      withTimeout(
        syncTransactions(false).then((tx) => contributionStats(externalCashflows(tx.items)).netContributions),
        40_000,
        null as number | null,
      ),
    ]);
    focus.forEach((m, i) => moverNews.set(m.ticker, fetched[i] ?? []));

    const divItems = dividends.items ?? [];
    const divToday = divItems
      .filter((x) => x.paidOn.slice(0, 10) === today)
      .map((x) => ({ ticker: prettyTicker(x.ticker), amount: x.amount }));
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const divWeek = divItems.filter((x) => x.paidOn.slice(0, 10) >= weekAgo).reduce((s, x) => s + x.amount, 0);

    // Account-level net deposits (deposits − withdrawals), same basis the dashboard
    // uses. Computed in-process above — calling /api/fire over HTTP would spawn a
    // second cold serverless instance and repeat the whole transaction sync.
    const netDeposits = netDepositsResult;

    const base: DigestPayload = {
      date: today,
      currency: summary.currency ?? "EUR",
      generatedAt: new Date().toISOString(),
      headline: "",
      mood: "quiet",
      story: [],
      storyCharts: [],
      education: [],
      portfolio: {
        totalValue: summary.totalValue,
        dayChange: histRes?.today.change ?? fallbackDayChange,
        dayChangePct:
          histRes?.today.changePct ??
          (fallbackDayChange != null && summary.totalValue - fallbackDayChange !== 0 ? fallbackDayChange / (summary.totalValue - fallbackDayChange) : null),
        netDeposits,
        totalReturn: netDeposits != null ? summary.totalValue - netDeposits : null,
        cash: summary.cash.availableToTrade + summary.cash.inPies,
        dividendsToday: divToday,
        dividendsThisWeek: divWeek,
      },
      macro,
      marketMovers,
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
      marketMovers,
      moverNews,
      dayChange: histRes?.today.change ?? null,
      dayChangePct: histRes?.today.changePct ?? null,
      divToday,
      divWeek,
      netDeposits,
    });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
    const userMsg = `Today's data:\n\n${context}\n\nWrite the digest JSON now.`;

    /**
     * Run one generation, accumulating tokens as they stream. If we hit the time
     * budget we abort but KEEP what already arrived — a truncated digest still
     * carries the headline and the first sections, which is far better than an
     * error. Returns whatever text we got (possibly partial).
     */
    async function generate(model: string, maxTokens: number, budgetMs: number): Promise<{ text: string; complete: boolean; error?: unknown }> {
      let acc = "";
      try {
        const stream = client.messages.stream({ model, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: "user", content: userMsg }] });
        stream.on("text", (t) => {
          acc += t;
        });
        // Swallow the stream's own error event; the awaited promise below reports it.
        stream.on("error", () => {});
        const done = await withTimeout(
          stream.finalMessage().then(
            () => ({ ok: true }) as const,
            (e: unknown) => ({ ok: false, e }) as const,
          ),
          budgetMs,
          null,
        );
        if (!done) {
          stream.abort();
          return { text: acc, complete: false, error: new Error("timeout") };
        }
        if (!done.ok) return { text: acc, complete: false, error: done.e };
        return { text: acc, complete: true };
      } catch (e) {
        return { text: acc, complete: false, error: e };
      }
    }

    /** Turn an SDK failure into something the user can actually act on. */
    function explain(err: unknown): string {
      const e = err as { status?: number; message?: string } | undefined;
      const msg = String(e?.message ?? "");
      if (/credit balance is too low/i.test(msg))
        return "Your Anthropic API credit has run out, so the commentary couldn't be written. Top up at console.anthropic.com/settings/billing — every number on this page is still live and correct.";
      if (e?.status === 401 || /authentication/i.test(msg)) return "The ANTHROPIC_API_KEY was rejected. Check the key in .env.local — the market data below is unaffected.";
      if (e?.status === 429 || /rate.?limit/i.test(msg)) return "Anthropic rate-limited the request. Wait a minute and press Rebuild — the data below is already up to date.";
      if (/timeout/i.test(msg)) return "The analysis ran past its time limit. Press Rebuild — the market data is cached now, so the retry is much faster.";
      if (e?.status && e.status >= 500) return "Anthropic had a server error. Press Rebuild in a moment — the data below is unaffected.";
      return `The commentary couldn't be generated (${msg.slice(0, 120) || "unknown error"}). The data below is live and correct.`;
    }

    // Opus writes the best analysis but is the slow part. Give it most of the
    // budget; if it can't finish (and nothing salvageable came back), retry once
    // on the faster model rather than showing the user an error.
    let parsed: Record<string, unknown> | null = null;
    let degraded: string | null = null;

    const first = await generate("claude-opus-4-8", 6500, 135_000);
    parsed = salvageJson(first.text);
    if (parsed && !first.complete) degraded = "Written right up to the time limit, so the later sections may be shorter than usual.";

    let lastError = first.error;
    if (!parsed) {
      // Only worth retrying if the failure was about time, not the account. A
      // credit/auth problem will fail identically on the second model.
      const fatal = /credit balance is too low|authentication/i.test(String((first.error as { message?: string })?.message ?? ""));
      if (!fatal) {
        const second = await generate("claude-sonnet-5", 6500, 90_000);
        parsed = salvageJson(second.text);
        lastError = second.error ?? first.error;
        if (parsed) degraded = "Today's commentary was written by the faster model — the main one ran long.";
      }
    }

    if (!parsed) {
      // Return the (useful) market data uncached, with the real reason so the user
      // knows whether to retry, top up credit, or fix a key.
      base.headline = "Markets and your portfolio are below — today's written commentary is missing.";
      base.note = explain(lastError);
      return NextResponse.json(base);
    }

    try {
      const p = parsed as {
        headline?: string;
        mood?: DigestPayload["mood"];
        story?: unknown;
        storyCharts?: { title?: string; symbols?: unknown; caption?: string }[];
        moverNotes?: { ticker: string; why: string }[];
        sections?: DigestSection[];
        education?: LearnTopic[];
      };
      const whyBy = new Map((p.moverNotes ?? []).map((n) => [n.ticker, n.why]));
      base.headline = p.headline?.trim() || "Your daily portfolio and market digest.";
      base.mood = p.mood ?? "mixed";
      // Accept either an array of paragraphs or one blob split on blank lines —
      // a partial stream can hand back either shape.
      base.story = (Array.isArray(p.story) ? p.story.map(String) : typeof p.story === "string" ? p.story.split(/\n{2,}/) : [])
        .map((t) => t.trim())
        .filter(Boolean);
      base.sections = (p.sections ?? []).filter((s) => s?.heading && s?.body);
      // Only keep charts we can actually draw: every symbol must exist in the macro
      // set with usable history, otherwise the card would render an empty axis.
      const plottable = new Set(base.macro.filter((m) => (m.history?.length ?? 0) > 2).map((m) => m.symbol));
      base.storyCharts = (p.storyCharts ?? [])
        .map((c) => ({
          title: String(c?.title ?? "").trim(),
          caption: String(c?.caption ?? "").trim(),
          symbols: (Array.isArray(c?.symbols) ? c.symbols.map(String) : []).filter((sym) => plottable.has(sym)),
        }))
        .filter((c) => c.title && c.symbols.length >= 2)
        .slice(0, 3);
      base.education = (p.education ?? [])
        .filter((t) => t?.concept && t?.explain)
        .map((t) => ({ ...t, readMore: (t.readMore ?? []).filter((r) => r?.url?.startsWith("https://")) }));
      base.gainers = base.gainers.map((g) => ({ ...g, why: whyBy.get(g.ticker) ?? "" }));
      base.losers = base.losers.map((l) => ({ ...l, why: whyBy.get(l.ticker) ?? "" }));
      if (degraded) base.note = degraded;
    } catch {
      base.headline = "Markets and your portfolio below — today's written commentary didn't come through.";
      base.note = "The analysis came back in an unexpected format. All the data on this page is live and correct; press Rebuild to try again.";
      return NextResponse.json(base); // uncached, so a retry can still succeed
    }

    // Only cache a digest that actually has commentary.
    if (base.sections.length > 0) store[key] = { at: Date.now(), payload: base } satisfies Cached;
    return NextResponse.json(base);
  } catch (err) {
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
