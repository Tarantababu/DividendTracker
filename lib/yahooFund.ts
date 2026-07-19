// Yahoo fund/ETF fundamentals fetcher: crumb+cookie auth, quoteSummary parsing,
// and a light symbol-resolver. Shared by /api/fund and /api/lookthrough.
import type { FundHolding, FundInfo, SectorWeight } from "./signals";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const TTL_MS = 6 * 60 * 60 * 1000; // fundamentals move slowly

interface CacheEntry {
  at: number;
  fund: FundInfo | null;
}
const cache: Map<string, CacheEntry> = ((globalThis as Record<string, unknown>).__fundCache ??= new Map()) as Map<string, CacheEntry>;
const symbolCache: Map<string, string> = ((globalThis as Record<string, unknown>).__symbolCache ??= new Map()) as Map<string, string>;

// Yahoo quoteSummary needs a cookie + crumb pair; cache it and refresh on 401.
interface Cred {
  cookie: string;
  crumb: string;
}
async function getCred(force = false): Promise<Cred | null> {
  const store = globalThis as Record<string, unknown>;
  if (!force && store.__yahooCred) return store.__yahooCred as Cred;
  try {
    const res = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
    const setCookie = res.headers.get("set-cookie");
    const cookie = setCookie ? setCookie.split(";")[0] : "";
    if (!cookie) return null;
    const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
    const crumb = (await cr.text()).trim();
    if (!crumb || crumb.includes("<")) return null;
    const cred: Cred = { cookie, crumb };
    store.__yahooCred = cred;
    return cred;
  } catch {
    return null;
  }
}

type YahooNum = { raw?: number } | number | undefined;
const raw = (v: YahooNum): number | null => (typeof v === "number" ? v : v && typeof v.raw === "number" ? v.raw : null);

const SECTOR_LABELS: Record<string, string> = {
  realestate: "Real estate",
  consumer_cyclical: "Consumer cyclical",
  basic_materials: "Basic materials",
  consumer_defensive: "Consumer defensive",
  technology: "Technology",
  communication_services: "Communication",
  financial_services: "Financials",
  healthcare: "Healthcare",
  industrials: "Industrials",
  energy: "Energy",
  utilities: "Utilities",
};
const prettySector = (k: string) => SECTOR_LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseFund(symbol: string, r: any): FundInfo | null {
  if (!r) return null;
  const fp = r.fundProfile ?? {};
  const sd = r.summaryDetail ?? {};
  const ks = r.defaultKeyStatistics ?? {};
  const th = r.topHoldings ?? {};
  const price = raw(r.price?.regularMarketPrice) ?? raw(sd.previousClose);
  const legalType: string = fp.legalType ?? r.quoteType?.quoteType ?? "";
  const isEtf = /etf|fund/i.test(legalType) || r.price?.quoteType === "ETF" || (Array.isArray(th.holdings) && th.holdings.length > 0 && !!fp.categoryName);

  const navPrice = raw(sd.navPrice);
  let premiumPct = navPrice != null && navPrice > 0 && price != null ? price / navPrice - 1 : null;
  // A real ETF premium/discount is a few % at most; anything larger is a price/NAV
  // unit mismatch (e.g. GBp price vs GBP NAV on London lines) — suppress the garbage.
  if (premiumPct != null && Math.abs(premiumPct) > 0.15) premiumPct = null;

  // Yahoo returns 0 for a missing TER on many UCITS lines; a real fund isn't free.
  const ter = raw(fp.feesExpensesInvestment?.annualReportExpenseRatio) ?? raw(ks.annualReportExpenseRatio);

  const holdings: FundHolding[] = (th.holdings ?? [])
    .map((h: any) => ({ symbol: h.symbol ?? "", name: h.holdingName ?? h.symbol ?? "", weight: raw(h.holdingPercent) ?? 0 }))
    .filter((h: FundHolding) => h.weight > 0);
  const topConcentration = holdings.length > 0 ? holdings.slice(0, 10).reduce((a, h) => a + h.weight, 0) : null;

  const sectors: SectorWeight[] = (th.sectorWeightings ?? [])
    .map((s: Record<string, YahooNum>) => {
      const [key, val] = Object.entries(s)[0] ?? [];
      return { sector: prettySector(key ?? ""), weight: raw(val) ?? 0 };
    })
    .filter((s: SectorWeight) => s.weight > 0)
    .sort((a: SectorWeight, b: SectorWeight) => b.weight - a.weight);

  const inceptionRaw = raw(ks.fundInceptionDate);

  return {
    symbol,
    isEtf,
    category: fp.categoryName ?? null,
    family: fp.family ?? null,
    expenseRatio: ter && ter > 0 ? ter : null,
    yield: raw(sd.yield) ?? raw(ks.yield),
    aum: raw(sd.totalAssets),
    navPrice,
    premiumPct,
    beta3y: raw(ks.beta3Year),
    threeYearReturn: raw(ks.threeYearAverageReturn),
    inceptionDate: inceptionRaw ? new Date(inceptionRaw * 1000).toISOString().slice(0, 10) : null,
    holdings,
    topConcentration,
    sectors,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Fetch (and cache 6h) fund fundamentals for one Yahoo symbol. Null on failure/non-fund. */
export async function fetchFundInfo(symbol: string): Promise<FundInfo | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.fund;

  const modules = "summaryDetail,fundProfile,defaultKeyStatistics,topHoldings,price,quoteType";
  for (let attempt = 0; attempt < 2; attempt++) {
    const cred = await getCred(attempt > 0);
    if (!cred) break;
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(cred.crumb)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cred.cookie }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) continue; // stale crumb → refresh once
    if (!res.ok) break;
    const data = (await res.json()) as { quoteSummary?: { result?: unknown[] } };
    const result = data.quoteSummary?.result?.[0];
    const fund = parseFund(symbol, result);
    cache.set(symbol, { at: Date.now(), fund });
    return fund;
  }
  cache.set(symbol, { at: Date.now(), fund: null });
  return null;
}

/**
 * Resolve a holding to its Yahoo symbol via search. Prefers an exact match on the
 * ticker guess, else the first equity/ETF hit. Falls back to the guess itself.
 */
export async function resolveSymbol(name: string, guess: string): Promise<string> {
  const key = `${name}|${guess}`.toUpperCase();
  const cached = symbolCache.get(key);
  if (cached) return cached;
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=8&newsCount=0`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { quotes?: Array<{ symbol: string; quoteType: string }> };
      const hits = (data.quotes ?? []).filter((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF");
      const best = hits.find((h) => h.symbol.toUpperCase() === guess.toUpperCase()) ?? hits[0];
      if (best?.symbol) {
        symbolCache.set(key, best.symbol);
        return best.symbol;
      }
    }
  } catch {
    /* fall through to guess */
  }
  symbolCache.set(key, guess);
  return guess;
}
