import fs from "fs/promises";
import path from "path";
import type { AccountSummary, DividendItem, DividendsPayload, Position } from "./types";

const HOST = process.env.T212_HOST ?? "https://live.trading212.com";
import { CACHE_DIR } from "./cacheDir";
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
async function t212Get<T>(pathname: string, maxRetries = 6): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${HOST}${pathname}`, {
      headers: { Authorization: authHeader() },
      cache: "no-store",
    });
    if (res.status === 429) {
      if (attempt >= maxRetries) throw new T212Error("RATE_LIMITED", `Rate limited on ${pathname} after ${maxRetries} retries`);
      await sleep(11_000);
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

export async function getAccountSummary(): Promise<AccountSummary> {
  return t212Get<AccountSummary>("/api/v0/equity/account/summary");
}

export async function getPositions(): Promise<Position[]> {
  return t212Get<Position[]>("/api/v0/equity/positions");
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
