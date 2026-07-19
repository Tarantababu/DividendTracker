import type { DividendItem, Position } from "./types";

export interface MonthlyDividend {
  month: string; // "2026-07"
  label: string; // "Jul 26"
  total: number;
}

export interface TickerDividendStats {
  ticker: string;
  name: string;
  ttm: number; // dividends received in trailing 12 months
  allTime: number;
  currentValue: number;
  totalCost: number;
  yieldOnValue: number | null; // ttm / currentValue
  yieldOnCost: number | null; // ttm / totalCost
  payments: number;
}

export function prettyTicker(raw: string): string {
  // "AAPL_US_EQ" -> "AAPL", "VUSAl_EQ" -> "VUSA"
  const base = raw.split("_")[0];
  return base.replace(/[a-z]+$/, "");
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
}

/** Continuous month series from first dividend (or `months` back) to current month. */
export function groupByMonth(items: DividendItem[], months?: number): MonthlyDividend[] {
  const totals = new Map<string, number>();
  for (const d of items) {
    const k = monthKey(d.paidOn);
    totals.set(k, (totals.get(k) ?? 0) + d.amount);
  }
  if (totals.size === 0) return [];

  const keys = [...totals.keys()].sort();
  const now = new Date();
  const end = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 };
  let [sy, sm] = keys[0].split("-").map(Number);
  if (months) {
    const startIdx = end.y * 12 + (end.m - 1) - (months - 1);
    sy = Math.floor(startIdx / 12);
    sm = (startIdx % 12) + 1;
  }
  const out: MonthlyDividend[] = [];
  for (let y = sy, m = sm; y < end.y || (y === end.y && m <= end.m); m === 12 ? (y++, m = 1) : m++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month: k, label: monthLabel(k), total: totals.get(k) ?? 0 });
  }
  return out;
}

export function totalInRange(items: DividendItem[], daysBack: number): number {
  const cutoff = Date.now() - daysBack * 86_400_000;
  return items.filter((d) => Date.parse(d.paidOn) >= cutoff).reduce((s, d) => s + d.amount, 0);
}

export function perTickerStats(items: DividendItem[], positions: Position[]): TickerDividendStats[] {
  const cutoff = Date.now() - 365 * 86_400_000;
  const byTicker = new Map<string, TickerDividendStats>();

  for (const p of positions) {
    byTicker.set(p.instrument.ticker, {
      ticker: p.instrument.ticker,
      name: p.instrument.name,
      ttm: 0,
      allTime: 0,
      currentValue: p.walletImpact.currentValue,
      totalCost: p.walletImpact.totalCost,
      yieldOnValue: null,
      yieldOnCost: null,
      payments: 0,
    });
  }
  for (const d of items) {
    let s = byTicker.get(d.ticker);
    if (!s) {
      s = { ticker: d.ticker, name: prettyTicker(d.ticker), ttm: 0, allTime: 0, currentValue: 0, totalCost: 0, yieldOnValue: null, yieldOnCost: null, payments: 0 };
      byTicker.set(d.ticker, s);
    }
    s.allTime += d.amount;
    s.payments++;
    if (Date.parse(d.paidOn) >= cutoff) s.ttm += d.amount;
  }
  for (const s of byTicker.values()) {
    if (s.currentValue > 0) s.yieldOnValue = s.ttm / s.currentValue;
    if (s.totalCost > 0) s.yieldOnCost = s.ttm / s.totalCost;
  }
  return [...byTicker.values()].sort((a, b) => b.ttm - a.ttm || b.currentValue - a.currentValue);
}

export interface FuturePayment {
  month: string; // "2026-08"
  label: string; // "Aug 26"
  total: number;
  byTicker: { ticker: string; amount: number }[];
}

/**
 * Naive projection: each holding repeats, in the next 12 calendar months,
 * what it paid in the same calendar month during the trailing 12 months.
 */
export function projectFuturePayments(items: DividendItem[], positions: Position[]): FuturePayment[] {
  const held = new Set(positions.map((p) => p.instrument.ticker));
  const cutoff = Date.now() - 365 * 86_400_000;
  // calendar month (0-11) -> ticker -> paid amount in trailing year
  const byMonth = new Map<number, Map<string, number>>();
  for (const d of items) {
    const ts = Date.parse(d.paidOn);
    if (ts < cutoff || !held.has(d.ticker)) continue;
    const m = new Date(d.paidOn).getMonth();
    const inner = byMonth.get(m) ?? new Map<string, number>();
    inner.set(d.ticker, (inner.get(d.ticker) ?? 0) + d.amount);
    byMonth.set(m, inner);
  }
  const now = new Date();
  const out: FuturePayment[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const inner = byMonth.get(d.getMonth()) ?? new Map<string, number>();
    const byTicker = [...inner.entries()].map(([ticker, amount]) => ({ ticker, amount })).sort((a, b) => b.amount - a.amount);
    out.push({ month: key, label: monthLabel(key), total: byTicker.reduce((s, t) => s + t.amount, 0), byTicker });
  }
  return out;
}

export interface YearlyByMonth {
  label: string; // "Jan"
  [year: string]: number | string;
}

/** Calendar-month totals split by year, for year-over-year comparison. */
export function dividendGrowthByYear(items: DividendItem[]): { data: YearlyByMonth[]; years: string[] } {
  const years = new Set<string>();
  const totals = new Map<string, number>(); // "year-month" -> total
  for (const d of items) {
    const dt = new Date(d.paidOn);
    const y = String(dt.getFullYear());
    years.add(y);
    const k = `${y}-${dt.getMonth()}`;
    totals.set(k, (totals.get(k) ?? 0) + d.amount);
  }
  const sortedYears = [...years].sort();
  const data: YearlyByMonth[] = MONTH_LABELS.map((label, m) => {
    const row: YearlyByMonth = { label };
    for (const y of sortedYears) row[y] = totals.get(`${y}-${m}`) ?? 0;
    return row;
  });
  return { data, years: sortedYears };
}

export interface HoldingGrowth {
  ticker: string;
  name: string;
  growth: number; // ttm vs previous 12 months
}

/**
 * Dividend growth per holding: per-share payout rate in the trailing 12 months
 * vs the 12 months before. Per-share (grossAmountPerShare) so buying more
 * shares doesn't count as "growth"; each window is normalized by the number of
 * months that actually had payments to tolerate partially covered windows.
 */
export function annualGrowthPerHolding(items: DividendItem[], positions: Position[]): HoldingGrowth[] {
  const held = new Map(positions.map((p) => [p.instrument.ticker, p.instrument.name]));
  const now = Date.now();
  type Window = { perShare: number; months: Set<string> };
  const ttm = new Map<string, Window>();
  const prev = new Map<string, Window>();

  for (const d of items) {
    if (!held.has(d.ticker) || d.grossAmountPerShare == null) continue;
    const age = now - Date.parse(d.paidOn);
    const bucket = age < 365 * 86_400_000 ? ttm : age < 730 * 86_400_000 ? prev : null;
    if (!bucket) continue;
    const w = bucket.get(d.ticker) ?? { perShare: 0, months: new Set<string>() };
    w.perShare += d.grossAmountPerShare;
    w.months.add(monthKey(d.paidOn));
    bucket.set(d.ticker, w);
  }

  const out: HoldingGrowth[] = [];
  for (const [ticker, p] of prev) {
    const t = ttm.get(ticker);
    if (!t || p.months.size === 0 || t.months.size === 0) continue;
    const prevRate = p.perShare / p.months.size;
    const ttmRate = t.perShare / t.months.size;
    if (prevRate > 0) out.push({ ticker, name: held.get(ticker) ?? ticker, growth: ttmRate / prevRate - 1 });
  }
  return out.sort((a, b) => b.growth - a.growth);
}

export function formatMoney(v: number, currency: string, digits = 2): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

export function formatPct(v: number | null, digits = 2): string {
  if (v === null || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
