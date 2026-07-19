// Stage 1: pull everything the episode needs from the running app into
// episodes/<week>/data.json, with week-over-week deltas computed here so the
// script stage never has to do arithmetic (Claude narrates, it doesn't calculate).
import path from "node:path";
import { episodeDir, fetchJson, isoWeekId, loadConfig, loadEnv, previousEpisodeDir, readJson, writeJson } from "./util.ts";
// The app's FIRE math, reused directly so episode numbers match the /fire page exactly
import { FIRE_TYPES, fireTarget, projectFire } from "../../lib/fire.ts";

interface DayPoint {
  date: string;
  value: number;
  cost: number;
}

export interface MacroIndex {
  symbol: string;
  name: string;
  price: number;
  weekPct: number | null;
  currency: string;
}

export interface EpisodeData {
  week: string;
  generatedAt: string;
  currency: string;
  portfolio: {
    totalValue: number;
    cash: number;
    invested: number;
    unrealizedPL: number;
    holdingsCount: number;
    weekChange: number | null; // EUR over the last 7 calendar days of history
    weekChangePct: number | null;
    topWinner: { ticker: string; change: number } | null;
    topLoser: { ticker: string; change: number } | null;
  };
  valueSeries: DayPoint[]; // ~90d for the chart scene
  dividends: {
    thisWeek: Array<{ date: string; label: string; amount: number }>;
    thisWeekTotal: number;
    trailing12m: number;
    monthlyAvg: number;
  };
  trades: { buys: number; sells: number; deposits: number; withdrawals: number; netInvestedThisWeek: number };
  fire: {
    xirrPct: number | null;
    netContributions: number;
    growth: number;
    savingsRatePct: number | null;
    monthlyExpenses: number | null;
    types: Array<{ key: string; label: string; target: number; progressPct: number; etaYears: number | null }>;
    dividendCoveragePct: number | null;
  };
  lookthrough: Array<{ symbol: string; name: string; pct: number; funds: number }>;
  macro: { indices: MacroIndex[]; headlines: Array<{ title: string; source: string; date: string }> };
  holdingsNews: Array<{ ticker: string; name: string; headlines: Array<{ title: string; source: string; date: string }> }>;
  prevEpisode: {
    week: string;
    totalValue: number;
    fireEtaYears: number | null;
    dividendsTrailing12m: number;
  } | null;
}

async function main() {
  loadEnv();
  const cfg = loadConfig();
  const B = cfg.baseUrl;
  const week = isoWeekId();
  const dir = episodeDir(week);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [overview, fire, history, events, lookthrough] = await Promise.all([
    fetchJson<any>(`${B}/api/overview`),
    fetchJson<any>(`${B}/api/fire`),
    fetchJson<any>(`${B}/api/portfolio-history`),
    fetchJson<any>(`${B}/api/events`),
    fetchJson<any>(`${B}/api/lookthrough`).catch(() => null),
  ]);

  // Macro: quotes for the configured indices; week change from the last 6 closes
  const symbols = cfg.macroSymbols.map((m) => m.symbol).join(",");
  const quotes = await fetchJson<any>(`${B}/api/quotes?symbols=${encodeURIComponent(symbols)}`).catch(() => ({ quotes: [] }));
  const indices: MacroIndex[] = cfg.macroSymbols.map((m) => {
    const q = (quotes.quotes ?? []).find((x: any) => x.symbol.toUpperCase() === m.symbol.toUpperCase());
    if (!q) return { symbol: m.symbol, name: m.name, price: 0, weekPct: null, currency: "" };
    const spark: number[] = q.spark ?? [];
    const weekAgo = spark.length >= 6 ? spark[spark.length - 6] : null;
    return {
      symbol: m.symbol,
      name: m.name,
      price: q.price,
      weekPct: weekAgo && weekAgo > 0 ? q.price / weekAgo - 1 : null,
      currency: q.currency,
    };
  });
  const news = await fetchJson<any>(`${B}/api/news?symbol=%5EGSPC&name=${encodeURIComponent("stock market this week")}`).catch(() => ({ items: [] }));

  // News around the actual holdings: top positions by value, a few headlines each
  const topPositions = [...overview.positions]
    .sort((a: any, b: any) => b.walletImpact.currentValue - a.walletImpact.currentValue)
    .slice(0, 4);
  const holdingsNews = (
    await Promise.all(
      topPositions.map(async (p: any) => {
        const ticker = p.instrument.ticker.split("_")[0].replace(/[a-z]+$/, "");
        const r = await fetchJson<any>(`${B}/api/news?symbol=${encodeURIComponent(ticker)}&name=${encodeURIComponent(p.instrument.name)}`).catch(() => ({ items: [] }));
        return {
          ticker,
          name: p.instrument.name,
          headlines: (r.items ?? []).slice(0, 3).map((n: any) => ({ title: n.title, source: n.source, date: n.publishedAt?.slice(0, 10) ?? "" })),
        };
      }),
    )
  ).filter((h) => h.headlines.length > 0);

  // Week window: last 7 calendar days
  const weekAgoIso = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const hist: DayPoint[] = history.history ?? [];
  const last = hist[hist.length - 1];
  const weekAgoPoint = [...hist].reverse().find((p) => p.date <= weekAgoIso) ?? hist[0];
  // Strip contributions out of the weekly move: Δvalue − Δinvested = market effect
  const weekChange = last && weekAgoPoint ? last.value - weekAgoPoint.value - (last.cost - weekAgoPoint.cost) : null;
  const weekChangePct = weekChange != null && weekAgoPoint && weekAgoPoint.value > 0 ? weekChange / weekAgoPoint.value : null;

  const movers = history.today?.movers ?? [];
  const evWeek = (events.events ?? []).filter((e: any) => e.date >= weekAgoIso);
  const divsWeek = evWeek.filter((e: any) => e.kind === "dividend");
  const buys = evWeek.filter((e: any) => e.kind === "buy");
  const sells = evWeek.filter((e: any) => e.kind === "sell");
  const deposits = evWeek.filter((e: any) => e.kind === "deposit");
  const withdrawals = evWeek.filter((e: any) => e.kind === "withdrawal");

  // FIRE per-type projections are computed client-side in the app; recompute here
  // with the same lib + defaults the /fire page uses.
  const effReturn = fire.xirrPct != null ? Math.min(12, Math.max(0, fire.xirrPct)) : 6;
  const monthlyExpenses = fire.budget ? Math.round(fire.budget.monthlyExpenses) : 2500;
  const contribution = fire.budget && fire.budget.monthlyNet > 0 ? Math.round(fire.budget.monthlyNet) : Math.max(0, Math.round(fire.monthlyContribution12m));
  const yieldPct = fire.totalValue > 0 ? (fire.dividends12m / fire.totalValue) * 100 : 0;
  const targetInputs = {
    monthlyExpenses,
    withdrawalRatePct: 4,
    annualReturnPct: effReturn,
    portfolioYieldPct: yieldPct,
    leanPct: 60,
    fatMultiple: 2,
    baristaMonthlyIncome: 1000,
    coastYears: 15,
  };
  const types = FIRE_TYPES.map((t: any) => {
    const target = fireTarget(t.key, targetInputs);
    const p = projectFire({ currentValue: fire.totalValue, monthlyContribution: contribution, annualReturnPct: effReturn, target, incomeRatePct: t.key === "dividend" ? yieldPct : 4 });
    return { key: t.key, label: t.label, target: Math.round(target), progressPct: p.progressPct, etaYears: p.monthsToTarget != null ? Math.round((p.monthsToTarget / 12) * 10) / 10 : null };
  });

  const prevDir = previousEpisodeDir(week);
  const prev = prevDir ? readJson<EpisodeData>(path.join(prevDir, "data.json")) : null;

  const data: EpisodeData = {
    week,
    generatedAt: new Date().toISOString(),
    currency: overview.summary.currency ?? "EUR",
    portfolio: {
      totalValue: overview.summary.totalValue,
      cash: overview.summary.cash.availableToTrade + overview.summary.cash.inPies,
      invested: overview.summary.investments.currentValue,
      unrealizedPL: overview.summary.investments.unrealizedProfitLoss,
      holdingsCount: overview.positions.length,
      weekChange: weekChange != null ? Math.round(weekChange * 100) / 100 : null,
      weekChangePct,
      topWinner: movers[0] ? { ticker: movers[0].ticker, change: movers[0].dayChange } : null,
      topLoser: movers.length ? { ticker: movers[movers.length - 1].ticker, change: movers[movers.length - 1].dayChange } : null,
    },
    valueSeries: hist.slice(-90),
    dividends: {
      thisWeek: divsWeek.map((d: any) => ({ date: d.date, label: d.label, amount: d.amount })),
      thisWeekTotal: Math.round(divsWeek.reduce((a: number, d: any) => a + d.amount, 0) * 100) / 100,
      trailing12m: Math.round(fire.dividends12m * 100) / 100,
      monthlyAvg: Math.round(fire.dividendsMonthly12m * 100) / 100,
    },
    trades: {
      buys: buys.length,
      sells: sells.length,
      deposits: deposits.length,
      withdrawals: withdrawals.length,
      netInvestedThisWeek: Math.round((buys.reduce((a: number, b: any) => a + b.amount, 0) - sells.reduce((a: number, s: any) => a + s.amount, 0)) * 100) / 100,
    },
    fire: {
      xirrPct: fire.xirrPct,
      netContributions: fire.netContributions,
      growth: fire.growth,
      savingsRatePct: fire.budget ? fire.budget.savingsRate * 100 : null,
      monthlyExpenses: fire.budget ? fire.budget.monthlyExpenses : null,
      types,
      dividendCoveragePct: monthlyExpenses > 0 ? (fire.dividendsMonthly12m / monthlyExpenses) * 100 : null,
    },
    lookthrough: (lookthrough?.stocks ?? []).slice(0, 5).map((s: any) => ({ symbol: s.symbol, name: s.name, pct: s.pct, funds: s.funds.length })),
    macro: {
      indices,
      headlines: (news.items ?? []).slice(0, 8).map((n: any) => ({ title: n.title, source: n.source, date: n.publishedAt?.slice(0, 10) ?? "" })),
    },
    holdingsNews,
    prevEpisode: prev
      ? {
          week: prev.week,
          totalValue: prev.portfolio.totalValue,
          fireEtaYears: prev.fire.types.find((t) => t.key === "regular")?.etaYears ?? null,
          dividendsTrailing12m: prev.dividends.trailing12m,
        }
      : null,
  };

  writeJson(path.join(dir, "data.json"), data);
  console.log(`[snapshot] ${week}: value=${data.portfolio.totalValue} weekMarketChange=${data.portfolio.weekChange} dividendsThisWeek=${data.dividends.thisWeekTotal} -> ${path.join(dir, "data.json")}`);
}

main().catch((err) => {
  console.error("[snapshot] FAILED:", err.message ?? err);
  process.exit(1);
});
