import fs from "fs/promises";
import path from "path";
import type { AccountSummary, DividendItem, DividendsPayload, Position } from "./types";

const HOST = process.env.T212_HOST ?? "https://live.trading212.com";
import { CACHE_DIR } from "./cacheDir";
import { readDiskCache, writeDiskCache } from "./diskCache";
const DIVIDENDS_CACHE = path.join(CACHE_DIR, "dividends.json");

function authHeader(): string {
  const key = process.env.T212_API_KEY;
  const secret = process.env.T212_API_SECRET;
  if (!key || !secret) {
    throw new T212Error("MISSING_CREDENTIALS", "T212_API_KEY / T212_API_SECRET not set in .env.local");
  }
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

export class T212Error extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET against the T212 API with 429 backoff. `pathname` starts with /api/v0/... */
/**
 * Trading212 publishes its limits on every response:
 *   x-ratelimit-limit / -period / -remaining / -reset
 * We track them per endpoint class and wait exactly as long as the API says,
 * instead of discovering the limit by getting a 429 and sleeping a flat 11s.
 * That flat sleep was the single biggest source of latency: five pie-detail
 * calls cost ~55s of pure backoff.
 */
interface RateState {
  /** unix ms when the current window resets */
  resetAt: number;
  remaining: number;
  /** serialises calls within one endpoint class */
  chain: Promise<unknown>;
}
const rateStates = ((globalThis as Record<string, unknown>).__t212Rate ??= new Map<string, RateState>()) as Map<string, RateState>;

/** Group by endpoint shape so ids don't fragment the budget: /pies/123 → /pies/:id */
function rateKey(pathname: string): string {
  return pathname.split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:id");
}

function stateFor(key: string): RateState {
  let s = rateStates.get(key);
  if (!s) {
    s = { resetAt: 0, remaining: 1, chain: Promise.resolve() };
    rateStates.set(key, s);
  }
  return s;
}

async function requestOnce<T>(pathname: string, key: string, maxRetries: number): Promise<T> {
  const st = stateFor(key);
  for (let attempt = 0; ; attempt++) {
    // Proactive wait: the previous response already told us the window is spent.
    const waitMs = st.remaining <= 0 ? st.resetAt - Date.now() : 0;
    if (waitMs > 0) await sleep(Math.min(waitMs + 120, 30_000));

    const res = await fetch(`${HOST}${pathname}`, { headers: { Authorization: authHeader() }, cache: "no-store" });

    // Record what the API just told us about the budget.
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    const resetSec = Number(res.headers.get("x-ratelimit-reset"));
    const period = Number(res.headers.get("x-ratelimit-period"));
    if (Number.isFinite(remaining)) st.remaining = remaining;
    if (Number.isFinite(resetSec) && resetSec > 0) st.resetAt = resetSec * 1000;
    else if (Number.isFinite(period) && period > 0) st.resetAt = Date.now() + period * 1000;

    if (res.status === 429) {
      if (attempt >= maxRetries) throw new T212Error("RATE_LIMITED", `Rate limited on ${pathname} after ${maxRetries} retries`);
      const retryAfter = Number(res.headers.get("retry-after"));
      const until = Number.isFinite(retryAfter) && retryAfter > 0 ? Date.now() + retryAfter * 1000 : st.resetAt;
      // Fall back to a short exponential backoff only when the API said nothing.
      const ms = until > Date.now() ? until - Date.now() + 150 : Math.min(1000 * 2 ** attempt, 8000);
      st.remaining = 0;
      await sleep(Math.min(ms, 30_000));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new T212Error("AUTH_FAILED", `Trading212 rejected the credentials (HTTP ${res.status}). Check .env.local.`);
    }
    if (!res.ok) {
      throw new T212Error("API_ERROR", `Trading212 returned HTTP ${res.status} for ${pathname}`);
    }
    return (await res.json()) as T;
  }
}

/**
 * GET against the T212 API. Calls to the same endpoint class are serialised so
 * concurrent callers queue behind one another rather than all racing into a 429.
 */
async function t212Get<T>(pathname: string, maxRetries = 6): Promise<T> {
  const key = rateKey(pathname);
  const st = stateFor(key);
  const run = st.chain.then(
    () => requestOnce<T>(pathname, key, maxRetries),
    () => requestOnce<T>(pathname, key, maxRetries),
  );
  // Keep the chain alive even if this call rejects, so one failure doesn't wedge the queue.
  st.chain = run.catch(() => undefined);
  return run;
}

export async function getAccountSummary(): Promise<AccountSummary> {
  return t212Get<AccountSummary>("/api/v0/equity/account/summary");
}

export async function getPositions(): Promise<Position[]> {
  return t212Get<Position[]>("/api/v0/equity/positions");
}

// ---- Pies (the user's real Trading212 pies = their categories) --------------

export interface PieInstrument {
  ticker: string;
  value: number; // current EUR value in this pie
  invested: number; // cost basis in this pie
  ownedQuantity: number;
  currentShare: number; // fraction of the pie
}

export interface PieSummary {
  id: number;
  name: string;
  value: number; // pie current value (excl. pie cash)
  invested: number; // cost basis of current holdings (T212 priceAvgInvestedValue)
  netDeposits: number; // real money in − out; from the override file, else falls back to `invested`
  result: number; // unrealised P/L
  resultCoef: number;
  dividendGained: number; // dividends earned in this pie, all-time
  cash: number; // uninvested cash sitting in the pie
  instruments: PieInstrument[];
}

/**
 * Per-pie NET DEPOSITS (money in − out). Trading212's API exposes only cost basis
 * (priceAvgInvestedValue), never net deposits per pie, and it can't be reconstructed
 * from order history (dividend reinvestments are untaggable). So the real figures are
 * read from .cache/net-deposits.json (keyed by exact pie name), maintained by hand.
 */
async function loadNetDepositOverrides(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const merge = (parsed: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "number") out[k] = v;
  };
  // Local file (gitignored, private) for local dev.
  try {
    merge(JSON.parse(await fs.readFile(path.join(CACHE_DIR, "net-deposits.json"), "utf8")));
  } catch {
    /* no file */
  }
  // Env var (JSON) so the deployed app can have them without committing to a public repo.
  if (process.env.PIE_NET_DEPOSITS) {
    try {
      merge(JSON.parse(process.env.PIE_NET_DEPOSITS));
    } catch {
      /* malformed env */
    }
  }
  return out;
}

interface PieListItem {
  id: number;
  cash: number;
  dividendDetails?: { gained?: number };
  result: { priceAvgInvestedValue: number; priceAvgValue: number; priceAvgResult: number; priceAvgResultCoef: number };
}

interface PieDetail {
  settings: { name: string };
  instruments: Array<{ ticker: string; ownedQuantity: number; currentShare: number; result?: { priceAvgValue?: number; priceAvgInvestedValue?: number } }>;
}

// ---- Pie detail cache ------------------------------------------------------
// The list endpoint returns every money figure (value, invested, result,
// dividends, cash) in ONE request. The per-pie detail endpoint only adds the
// pie's name and its instrument mix — things that change when you edit a pie,
// not when prices move. Since detail calls are rate-limited to ~1 per 5s, they
// dominate the refresh cost (5 pies ≈ 25s). So we cache them and re-read only
// the list on a normal refresh, which makes a refresh a single fast call.
const PIE_DETAIL_FILE = "pie-details.json";
const PIE_DETAIL_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface CachedPieDetail {
  at: number;
  name: string;
  instruments: PieInstrument[];
}

/**
 * Instrument values are price-sensitive, so a cached set drifts from the pie's
 * fresh total. Their *proportions* drift far more slowly, and proportions are all
 * the app uses them for (splitting a ticker held in several pies). Rescaling the
 * cached instruments onto the fresh total keeps both the ratios and the absolute
 * figures consistent.
 */
function rescaleInstruments(instruments: PieInstrument[], freshValue: number, freshInvested: number): PieInstrument[] {
  const sumValue = instruments.reduce((a, i) => a + i.value, 0);
  const sumInvested = instruments.reduce((a, i) => a + i.invested, 0);
  const kv = sumValue > 0 && freshValue > 0 ? freshValue / sumValue : 1;
  const ki = sumInvested > 0 && freshInvested > 0 ? freshInvested / sumInvested : 1;
  return instruments.map((i) => ({ ...i, value: i.value * kv, invested: i.invested * ki }));
}

/**
 * All pies with their holdings — the authoritative per-category split, since a
 * shared ticker's real share of each pie is exact here (no proportional guessing).
 *
 * Always one list call for the live numbers; detail calls only for pies whose
 * cached instrument mix is missing or older than `detailMaxAgeMs`.
 */
export async function getPies(opts: { detailMaxAgeMs?: number } = {}): Promise<PieSummary[]> {
  const maxAge = opts.detailMaxAgeMs ?? PIE_DETAIL_MAX_AGE_MS;
  const [list, overrides, cacheRead] = await Promise.all([
    t212Get<PieListItem[]>("/api/v0/equity/pies"),
    loadNetDepositOverrides(),
    readDiskCache<Record<string, CachedPieDetail>>(PIE_DETAIL_FILE, Number.MAX_SAFE_INTEGER),
  ]);
  const details: Record<string, CachedPieDetail> = { ...(cacheRead?.value ?? {}) };

  const out: PieSummary[] = [];
  let cacheDirty = false;
  for (const p of list) {
    const key = String(p.id);
    let entry = details[key];

    // Only pay for a detail call when we have nothing cached or it's gone stale.
    if (!entry || Date.now() - entry.at > maxAge) {
      try {
        const detail = await t212Get<PieDetail>(`/api/v0/equity/pies/${p.id}`);
        entry = {
          at: Date.now(),
          name: detail.settings?.name ?? `Pie ${p.id}`,
          instruments: (detail.instruments ?? []).map((i) => ({
            ticker: i.ticker,
            value: i.result?.priceAvgValue ?? 0,
            invested: i.result?.priceAvgInvestedValue ?? 0,
            ownedQuantity: i.ownedQuantity,
            currentShare: i.currentShare,
          })),
        };
        details[key] = entry;
        cacheDirty = true;
      } catch (err) {
        // Rate-limited or transient: an old mix rescaled onto fresh totals is far
        // better than dropping the pie's composition entirely.
        if (!entry) throw err;
      }
    }

    const name = entry.name;
    out.push({
      id: p.id,
      name,
      value: p.result.priceAvgValue,
      invested: p.result.priceAvgInvestedValue,
      // real net deposits from the override; if absent, cost basis is the best proxy
      netDeposits: overrides[name] ?? p.result.priceAvgInvestedValue,
      result: p.result.priceAvgResult,
      resultCoef: p.result.priceAvgResultCoef,
      dividendGained: p.dividendDetails?.gained ?? 0,
      cash: p.cash ?? 0,
      instruments: rescaleInstruments(entry.instruments, p.result.priceAvgValue, p.result.priceAvgInvestedValue),
    });
  }

  if (cacheDirty) await writeDiskCache(PIE_DETAIL_FILE, details);
  return out;
}

function dividendKey(d: DividendItem): string {
  return d.reference ?? `${d.ticker}|${d.paidOn}|${d.amount}|${d.quantity}`;
}

async function readDividendCache(): Promise<DividendsPayload> {
  try {
    const raw = await fs.readFile(DIVIDENDS_CACHE, "utf8");
    return JSON.parse(raw) as DividendsPayload;
  } catch {
    return { items: [], lastSync: null };
  }
}

async function writeDividendCache(payload: DividendsPayload): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(DIVIDENDS_CACHE, JSON.stringify(payload), "utf8");
}

interface PaginatedDividends {
  items: DividendItem[];
  nextPagePath: string | null;
}

/**
 * Sync dividend history into the local file cache.
 * Newest records come first; we stop paging once a page contains only
 * already-cached items, so incremental refreshes cost 1-2 requests.
 * Rate limit is 6 req/min — full first sync of a long history is paced by 429 backoff.
 */
export async function syncDividends(force = false): Promise<DividendsPayload> {
  const cache = await readDividendCache();
  const known = new Set(cache.items.map(dividendKey));

  // Serve cache when fresh (< 30 min) unless forced
  if (!force && cache.lastSync && Date.now() - Date.parse(cache.lastSync) < 30 * 60_000) {
    return cache;
  }

  const fresh: DividendItem[] = [];
  let pagePath: string | null = "/api/v0/equity/history/dividends?limit=50";
  let pages = 0;

  while (pagePath) {
    const page: PaginatedDividends = await t212Get<PaginatedDividends>(pagePath);
    pages++;
    let newOnPage = 0;
    for (const item of page.items ?? []) {
      if (!known.has(dividendKey(item))) {
        known.add(dividendKey(item));
        fresh.push(item);
        newOnPage++;
      }
    }
    // Entire page already cached → history beyond this point is known
    if (cache.items.length > 0 && newOnPage === 0) break;
    pagePath = page.nextPagePath ? (page.nextPagePath.startsWith("/") ? page.nextPagePath : `/${page.nextPagePath}`) : null;
    if (pagePath && pages % 6 === 0) await sleep(61_000); // stay under 6 req/min on long first syncs
  }

  const items = [...fresh, ...cache.items].sort((a, b) => Date.parse(b.paidOn) - Date.parse(a.paidOn));
  const payload: DividendsPayload = { items, lastSync: new Date().toISOString(), syncedPages: pages };
  await writeDividendCache(payload);
  return payload;
}

// ---- Cash transactions & order history (for event markers) ----------------

export interface CashTransaction {
  type: string; // DEPOSIT, WITHDRAW(AL), INTEREST_ON_FREE_CASH, FEE, ...
  amount: number;
  currency: string;
  reference: string;
  dateTime: string;
}

export interface OrderFill {
  order: {
    id: number;
    ticker: string;
    side: "BUY" | "SELL";
    status: string;
    instrument?: { name: string; ticker: string };
  };
  fill?: {
    id: number;
    quantity: number;
    price: number;
    filledAt: string;
    walletImpact?: { currency: string; netValue: number };
  };
}

interface HistoryCache<T> {
  items: T[];
  lastSync: string | null;
}

interface Paginated<T> {
  items: T[];
  nextPagePath: string | null;
}

const MAX_HISTORY_DAYS = 4000; // effectively "since account opening" — XIRR needs every deposit

/**
 * Generic incremental sync for the paginated T212 history endpoints
 * (transactions, orders). Same strategy as dividends: newest first, stop when
 * a page is fully known or older than MAX_HISTORY_DAYS. `nextPagePath` is
 * sometimes a bare query string, sometimes a full path — handle both.
 */
async function syncHistory<T>(cacheFile: string, basePath: string, keyOf: (item: T) => string, dateOf: (item: T) => string, force: boolean): Promise<HistoryCache<T>> {
  const file = path.join(CACHE_DIR, cacheFile);
  let cache: HistoryCache<T> = { items: [], lastSync: null };
  try {
    cache = JSON.parse(await fs.readFile(file, "utf8")) as HistoryCache<T>;
  } catch {
    /* first run */
  }
  if (!force && cache.lastSync && Date.now() - Date.parse(cache.lastSync) < 30 * 60_000) return cache;

  const known = new Set(cache.items.map(keyOf));
  const cutoff = Date.now() - MAX_HISTORY_DAYS * 86400_000;
  const fresh: T[] = [];
  let pagePath: string | null = `${basePath}?limit=50`;
  let pages = 0;

  while (pagePath) {
    const page: Paginated<T> = await t212Get<Paginated<T>>(pagePath);
    pages++;
    let newOnPage = 0;
    let tooOld = false;
    for (const item of page.items ?? []) {
      if (Date.parse(dateOf(item)) < cutoff) {
        tooOld = true;
        continue;
      }
      const k = keyOf(item);
      if (!known.has(k)) {
        known.add(k);
        fresh.push(item);
        newOnPage++;
      }
    }
    if (tooOld || (cache.items.length > 0 && newOnPage === 0)) break;
    const next = page.nextPagePath;
    pagePath = next ? (next.startsWith("/") ? next : `${basePath}?${next.replace(/^\?/, "")}`) : null;
    if (pagePath && pages % 5 === 0) await sleep(61_000);
  }

  const items = [...fresh, ...cache.items].sort((a, b) => Date.parse(dateOf(b)) - Date.parse(dateOf(a)));
  const payload: HistoryCache<T> = { items, lastSync: new Date().toISOString() };
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload), "utf8");
  return payload;
}

export async function syncTransactions(force = false): Promise<HistoryCache<CashTransaction>> {
  return syncHistory<CashTransaction>(
    "transactions.json",
    "/api/v0/history/transactions",
    (t) => t.reference,
    (t) => t.dateTime,
    force,
  );
}

export async function syncOrders(force = false): Promise<HistoryCache<OrderFill>> {
  return syncHistory<OrderFill>(
    "orders.json",
    "/api/v0/equity/history/orders",
    (o) => (o.fill ? `f${o.fill.id}` : `o${o.order.id}`),
    (o) => o.fill?.filledAt ?? new Date().toISOString(),
    force,
  );
}
