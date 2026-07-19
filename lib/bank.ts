// GoCardless Bank Account Data (formerly Nordigen) client — the licensed-AISP path
// to N26 over PSD2. Handles token lifecycle, the requisition/consent flow, and
// transaction/balance fetches. Credentials live in .env.local (user adds them):
//   GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY
// Optional: GOCARDLESS_REDIRECT_URI (defaults to http://localhost:3000/budget),
//           N26_INSTITUTION_ID (defaults to N26 Germany).
import fs from "fs/promises";
import path from "path";

const BASE = "https://bankaccountdata.gocardless.com/api/v2";
const CACHE_DIR = path.join(process.cwd(), ".cache");
const LINK_FILE = path.join(CACHE_DIR, "bank-link.json");
const TX_FILE = path.join(CACHE_DIR, "bank-transactions.json");

/** N26 Germany. Other N26 lines exist per country; override via env if needed. */
export const N26_INSTITUTION_ID = process.env.N26_INSTITUTION_ID ?? "N26_NTSBDEB1";

export class BankError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function bankConfigured(): boolean {
  return !!(process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY);
}

function redirectUri(): string {
  return process.env.GOCARDLESS_REDIRECT_URI ?? "http://localhost:3000/budget";
}

// ---- token lifecycle (cached in the dev-server process) --------------------

interface Token {
  access: string;
  accessExp: number; // epoch ms
  refresh: string;
  refreshExp: number;
}

async function newToken(): Promise<Token> {
  const secret_id = process.env.GOCARDLESS_SECRET_ID;
  const secret_key = process.env.GOCARDLESS_SECRET_KEY;
  if (!secret_id || !secret_key) throw new BankError("NOT_CONFIGURED", "GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY not set in .env.local");
  const res = await fetch(`${BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ secret_id, secret_key }),
    cache: "no-store",
  });
  if (res.status === 401) throw new BankError("AUTH_FAILED", "GoCardless rejected the credentials — check GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY.");
  if (!res.ok) throw new BankError("API_ERROR", `GoCardless token endpoint returned HTTP ${res.status}`);
  const j = (await res.json()) as { access: string; access_expires: number; refresh: string; refresh_expires: number };
  const now = Date.now();
  return { access: j.access, accessExp: now + j.access_expires * 1000, refresh: j.refresh, refreshExp: now + j.refresh_expires * 1000 };
}

async function getAccess(): Promise<string> {
  const store = globalThis as Record<string, unknown>;
  let tok = store.__gcToken as Token | undefined;
  const now = Date.now();
  if (tok && tok.accessExp - 60_000 > now) return tok.access;

  if (tok && tok.refreshExp - 60_000 > now) {
    try {
      const res = await fetch(`${BASE}/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh: tok.refresh }),
        cache: "no-store",
      });
      if (res.ok) {
        const j = (await res.json()) as { access: string; access_expires: number };
        tok = { ...tok, access: j.access, accessExp: now + j.access_expires * 1000 };
        store.__gcToken = tok;
        return tok.access;
      }
    } catch {
      /* fall through to a fresh token */
    }
  }
  tok = await newToken();
  store.__gcToken = tok;
  return tok.access;
}

async function gcFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const access = await getAccess();
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 429) throw new BankError("RATE_LIMITED", "GoCardless rate limit hit (free tier allows a few syncs per day). Try again later.");
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string; summary?: string };
      detail = body.detail || body.summary || detail;
    } catch {
      /* non-JSON error */
    }
    throw new BankError("API_ERROR", `GoCardless ${pathname}: ${detail}`);
  }
  return (await res.json()) as T;
}

// ---- link persistence ------------------------------------------------------

export type BankSource = "gocardless" | "csv";

export interface BankLink {
  requisitionId: string;
  institutionId: string;
  reference: string;
  accountIds: string[];
  linkedAt: string | null; // set once accounts are resolved
  createdAt: string;
  source: BankSource;
}

export async function readLink(): Promise<BankLink | null> {
  try {
    return JSON.parse(await fs.readFile(LINK_FILE, "utf8")) as BankLink;
  } catch {
    return null;
  }
}

async function writeLink(link: BankLink): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(LINK_FILE, JSON.stringify(link), "utf8");
}

export async function clearLink(): Promise<void> {
  await fs.rm(LINK_FILE, { force: true });
  await fs.rm(TX_FILE, { force: true });
}

// ---- consent flow ----------------------------------------------------------

/** Start a fresh consent: create a requisition and return the N26 login link. */
export async function createRequisition(): Promise<{ link: string; requisitionId: string }> {
  const reference = `dt-${Date.now()}`;
  const body = {
    redirect: redirectUri(),
    institution_id: N26_INSTITUTION_ID,
    reference,
    user_language: "EN",
  };
  const req = await gcFetch<{ id: string; link: string }>("/requisitions/", { method: "POST", body: JSON.stringify(body) });
  await writeLink({ requisitionId: req.id, institutionId: N26_INSTITUTION_ID, reference, accountIds: [], linkedAt: null, createdAt: new Date().toISOString(), source: "gocardless" });
  return { link: req.link, requisitionId: req.id };
}

interface Requisition {
  id: string;
  status: string; // CR, GC, UA, RJ, SA, GA, LN (LN = linked)
  accounts: string[];
}

/** Resolve the stored requisition — pulls account ids once the user has approved. */
export async function refreshLink(): Promise<BankLink | null> {
  const link = await readLink();
  if (!link) return null;
  const req = await gcFetch<Requisition>(`/requisitions/${link.requisitionId}/`);
  if (req.accounts.length > 0) {
    const updated: BankLink = { ...link, accountIds: req.accounts, linkedAt: link.linkedAt ?? new Date().toISOString() };
    await writeLink(updated);
    return updated;
  }
  return link;
}

// ---- transactions & balances ----------------------------------------------

export interface RawTx {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  creditorName?: string;
  debtorName?: string;
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  proprietaryBankTransactionCode?: string;
  pending?: boolean;
}

export interface AccountBalance {
  accountId: string;
  amount: number;
  currency: string;
}

interface TxCache {
  syncedAt: string;
  transactions: RawTx[];
  balances: AccountBalance[];
}

function dedupe(txs: RawTx[]): RawTx[] {
  const seen = new Set<string>();
  return txs.filter((t) => {
    const key = t.transactionId ?? t.internalTransactionId ?? `${t.bookingDate}|${t.transactionAmount.amount}|${t.remittanceInformationUnstructured ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Persist a manual CSV import as if it were a bank sync — writes the same cache
 * files the GoCardless path uses, so the dashboard + FIRE handoff work unchanged.
 * No credentials required.
 */
export async function importTransactions(rawTx: RawTx[]): Promise<void> {
  const now = new Date().toISOString();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await writeLink({ requisitionId: "", institutionId: "csv", reference: "csv", accountIds: ["n26-csv"], linkedAt: now, createdAt: now, source: "csv" });
  const out: TxCache = { syncedAt: now, transactions: dedupe(rawTx), balances: [] };
  await fs.writeFile(TX_FILE, JSON.stringify(out), "utf8");
}

async function fetchAccountTransactions(accountId: string): Promise<RawTx[]> {
  const data = await gcFetch<{ transactions: { booked: RawTx[]; pending: RawTx[] } }>(`/accounts/${accountId}/transactions/`);
  const booked = (data.transactions.booked ?? []).map((t) => ({ ...t, pending: false }));
  const pending = (data.transactions.pending ?? []).map((t) => ({ ...t, pending: true }));
  return [...booked, ...pending];
}

async function fetchAccountBalance(accountId: string): Promise<AccountBalance | null> {
  try {
    const data = await gcFetch<{ balances: Array<{ balanceAmount: { amount: string; currency: string }; balanceType: string }> }>(`/accounts/${accountId}/balances/`);
    const pick = data.balances.find((b) => /interimAvailable|closingBooked|expected/i.test(b.balanceType)) ?? data.balances[0];
    if (!pick) return null;
    return { accountId, amount: Number(pick.balanceAmount.amount), currency: pick.balanceAmount.currency };
  } catch {
    return null;
  }
}

/**
 * Sync transactions + balances for all linked accounts. Free tier rate-limits
 * hard (~4/day/account), so results are cached; pass force to bypass the 6h TTL.
 */
export async function syncBank(force = false): Promise<TxCache> {
  let cache: TxCache | null = null;
  try {
    cache = JSON.parse(await fs.readFile(TX_FILE, "utf8")) as TxCache;
  } catch {
    /* first sync */
  }

  // CSV imports are static — never hit the network, just serve what was imported.
  let link = await readLink();
  if (link?.source === "csv") {
    if (cache) return cache;
    throw new BankError("NOT_LINKED", "No imported N26 CSV found — import a file first.");
  }

  // Use the stored account ids when we have them; only re-resolve the requisition
  // (a network call) when they're missing — keeps us well under the free-tier limit.
  const fresh = cache && Date.now() - Date.parse(cache.syncedAt) < 6 * 60 * 60 * 1000;
  if (!force && fresh && link && link.accountIds.length > 0) return cache!;
  if (!link || link.accountIds.length === 0) link = await refreshLink();
  if (!link || link.accountIds.length === 0) throw new BankError("NOT_LINKED", "No N26 account linked yet — start the consent flow first.");
  if (!force && cache && fresh) return cache;

  const all: RawTx[] = [];
  const balances: AccountBalance[] = [];
  try {
    for (const id of link.accountIds) {
      all.push(...(await fetchAccountTransactions(id)));
      const bal = await fetchAccountBalance(id);
      if (bal) balances.push(bal);
    }
  } catch (err) {
    // Free tier rate-limits hard; rather than fail, serve the last good cache.
    if (cache) return cache;
    throw err;
  }
  // De-dupe by transaction id (booked entries can reappear across syncs)
  const seen = new Set<string>();
  const deduped = all.filter((t) => {
    const key = t.transactionId ?? t.internalTransactionId ?? `${t.bookingDate}|${t.transactionAmount.amount}|${t.remittanceInformationUnstructured ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const out: TxCache = { syncedAt: new Date().toISOString(), transactions: deduped, balances };
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(TX_FILE, JSON.stringify(out), "utf8");
  return out;
}

export async function readBankCache(): Promise<TxCache | null> {
  try {
    return JSON.parse(await fs.readFile(TX_FILE, "utf8")) as TxCache;
  } catch {
    return null;
  }
}
