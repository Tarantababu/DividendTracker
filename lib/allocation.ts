"use client";

// Shared access to the user's category allocation (created on the dashboard
// Allocation tab, persisted in localStorage). Same-tab consumers stay in sync
// via the "allocation-changed" window event; other tabs via the storage event.

import { useEffect, useMemo, useState } from "react";
import type { Position } from "@/lib/types";
import { prettyTicker } from "@/lib/analytics";

export const ALLOCATION_KEY = "dividend-tracker-allocation-v1";
const CHANGE_EVENT = "allocation-changed";

export interface AllocationMember {
  id: string; // T212 ticker when added from holdings, else search symbol
  name: string;
  t212Ticker?: string;
  weightPct: number;
}

export interface AllocationCategory {
  id: string;
  name: string;
  targetPct: number;
  members: AllocationMember[];
}

export interface AllocationState {
  categories: AllocationCategory[];
  deposit: number;
}

export const CATEGORY_COLORS = ["#6d4aff", "#38a6f8", "#34d399", "#f5a623", "#f472b6", "#22d3ee", "#a78bfa", "#60a5fa", "#8b5cf6", "#c4b5fd"];
export const UNASSIGNED_COLOR = "#8a8fa3";

// Baked-in starter allocation so the tool is useful out of the box (no manual
// setup). Category targetPct sums to 100; each category's member weightPct sums
// to 100. t212Ticker matches the live Trading212 tickers so dashboard category
// colouring and rebalancing work immediately. The user can still edit/clear it on
// the Allocation tab — a saved state always wins over this default.
export const DEFAULT_ALLOCATION: AllocationState = {
  deposit: 500,
  categories: [
    {
      id: "div-growth",
      name: "Div. Growth",
      targetPct: 60,
      members: [
        { id: "ZPRGd_EQ", t212Ticker: "ZPRGd_EQ", name: "SPDR S&P Global Dividend Aristocrats", weightPct: 20 },
        { id: "FUSDd_EQ", t212Ticker: "FUSDd_EQ", name: "Fidelity US Quality Income (Dist)", weightPct: 20 },
        { id: "JGGIl_EQ", t212Ticker: "JGGIl_EQ", name: "JPMorgan Global Growth & Income", weightPct: 20 },
        { id: "QDVDd_EQ", t212Ticker: "QDVDd_EQ", name: "iShares MSCI USA Quality Dividend", weightPct: 20 },
        { id: "VUSAa_EQ", t212Ticker: "VUSAa_EQ", name: "Vanguard S&P 500 (Dist)", weightPct: 10 },
        { id: "QDVX1d_EQ", t212Ticker: "QDVX1d_EQ", name: "iShares MSCI Europe Quality Dividend", weightPct: 10 },
      ],
    },
    {
      id: "mid-yield",
      name: "Mid Yield",
      targetPct: 30,
      members: [
        { id: "JEGPl_EQ", t212Ticker: "JEGPl_EQ", name: "JPMorgan Global Equity Premium Income", weightPct: 50 },
        { id: "JEPQl_EQ", t212Ticker: "JEPQl_EQ", name: "JPMorgan Nasdaq Equity Premium Income", weightPct: 45 },
        { id: "QYLPl_EQ", t212Ticker: "QYLPl_EQ", name: "Global X Nasdaq 100 Covered Call", weightPct: 2 },
        { id: "XYLPl_EQ", t212Ticker: "XYLPl_EQ", name: "Global X S&P 500 Covered Call", weightPct: 1 },
        { id: "XYLUl_EQ", t212Ticker: "XYLUl_EQ", name: "Global X S&P 500 Covered Call (Dist)", weightPct: 1 },
        { id: "QYLDl_EQ", t212Ticker: "QYLDl_EQ", name: "Global X Nasdaq 100 Covered Call (Dist)", weightPct: 1 },
      ],
    },
    {
      id: "bitcoin",
      name: "Bitcoin",
      targetPct: 5,
      members: [{ id: "21BCd_EQ", t212Ticker: "21BCd_EQ", name: "21Shares Bitcoin Core", weightPct: 100 }],
    },
    {
      id: "mavi",
      name: "Mavi",
      targetPct: 5,
      members: [
        { id: "FUSDd_EQ", t212Ticker: "FUSDd_EQ", name: "Fidelity US Quality Income (Dist)", weightPct: 70 },
        { id: "JEQPd_EQ", t212Ticker: "JEQPd_EQ", name: "JPMorgan Nasdaq Equity Premium Income (Dist)", weightPct: 30 },
      ],
    },
  ],
};

/** Fresh deep copy of the default so callers never mutate the shared constant. */
export function defaultAllocation(): AllocationState {
  return JSON.parse(JSON.stringify(DEFAULT_ALLOCATION)) as AllocationState;
}

export function loadAllocation(): AllocationState {
  try {
    const raw = localStorage.getItem(ALLOCATION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AllocationState>;
      return { categories: parsed.categories ?? [], deposit: typeof parsed.deposit === "number" ? parsed.deposit : 500 };
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  return defaultAllocation();
}

export function saveAllocation(state: AllocationState) {
  localStorage.setItem(ALLOCATION_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Live view of the saved categories — re-renders when the Allocation tab edits them. */
export function useAllocation(): AllocationState {
  const [state, setState] = useState<AllocationState>({ categories: [], deposit: 500 });
  useEffect(() => {
    const sync = () => setState(loadAllocation());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return state;
}

export interface CategoryLookup {
  name: string;
  color: string;
  index: number;
}

// ---- Real Trading212 pies (authoritative category actuals) ------------------

export interface PieLike {
  name: string;
  value: number;
  invested: number; // cost basis
  netDeposits?: number; // real money in − out (from override); falls back to `invested`
  result: number;
  dividendGained: number;
  cash: number;
  instruments: { ticker: string; value: number; invested: number }[];
}

/** "Div. Growth (%60)" and "Div. Growth" both normalize equal, so a category name
 *  matches its pie regardless of the "(%..)" suffix the pie name carries. */
export const normalizePieName = (s: string) =>
  s
    .replace(/\(\s*%?\s*\d+\s*%?\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function piesByCategoryName(pies: PieLike[]): Map<string, PieLike> {
  return new Map(pies.map((p) => [normalizePieName(p.name), p]));
}

/** A pie's display name without the "(%..)" target suffix, original case kept. */
export const pieDisplayName = (s: string) =>
  s
    .replace(/\(\s*%?\s*\d+(?:\.\d+)?\s*%?\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Target % encoded in a pie name like "Div. Growth (%60)". null when absent. */
export function pieTargetPct(name: string): number | null {
  const m = name.match(/\(\s*%?\s*(\d+(?:\.\d+)?)\s*%?\s*\)/);
  return m ? Number(m[1]) : null;
}

/**
 * Build the category allocation straight from the live Trading212 pies — the
 * source of truth. Each pie is a category: name from the pie (minus its "(%..)"
 * suffix), target% parsed from that suffix (falling back to the pie's current
 * weight when the name carries none), members from the pie's instruments weighted
 * by their real current share. A ticker held in several pies simply appears in
 * each — no reconstruction or splitting, since every pie value is already exact.
 */
export function categoriesFromPies(pies: PieLike[]): AllocationCategory[] {
  const values = pies.map((p) => p.value || p.instruments.reduce((a, x) => a + x.value, 0));
  const totalValue = values.reduce((a, v) => a + v, 0);
  return pies.map((p, i) => {
    const value = values[i];
    const named = pieTargetPct(p.name);
    return {
      id: `pie-${normalizePieName(p.name) || i}`,
      name: pieDisplayName(p.name) || `Pie ${i + 1}`,
      targetPct: named ?? (totalValue > 0 ? (value / totalValue) * 100 : 0),
      members: p.instruments.map((ins) => ({
        id: ins.ticker,
        t212Ticker: ins.ticker,
        name: prettyTicker(ins.ticker),
        weightPct: value > 0 ? (ins.value / value) * 100 : 0,
      })),
    };
  });
}

/**
 * Category allocation for the dashboard: derived live from the Trading212 pies
 * when we have them, else the locally-saved allocation as an offline fallback.
 * Pies are the source of truth — everything downstream (donut, target bars,
 * per-category performance, the rebalance planner) reads from this.
 */
export function useLiveCategories(pies: PieLike[] | null | undefined): AllocationCategory[] {
  const saved = useAllocation().categories;
  return useMemo(() => (pies && pies.length ? categoriesFromPies(pies) : saved), [pies, saved]);
}

// Deduped client fetch of /api/pies. Four dashboard components consume pies; if
// each fetched on its own, a cold serverless cache would fan out into 4x the
// Trading212 calls and trip the pies-endpoint rate limit (→ 502 → null pies →
// wrong shared-ticker categories like Mavi). This shares ONE in-flight request
// and its result across every consumer, page-wide, with a single retry.
let piesCache: PieLike[] | null = null;
let piesPromise: Promise<PieLike[]> | null = null;

async function fetchPiesOnce(): Promise<PieLike[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/pies");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as { pies?: PieLike[] };
      return payload.pies ?? [];
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return [];
}

/**
 * Real Trading212 pies, shared by all consumers on the page.
 * Pass `seed` (e.g. from /api/overview) to use server-provided pies with zero
 * client fetch — category values are then exact from the first render, with no
 * window where the reconstructed fallback would briefly show. Without a seed it
 * fetches /api/pies once, deduped across every consumer.
 */
export function usePies(seed?: PieLike[] | null): PieLike[] | null {
  const seeded = seed && seed.length ? seed : null;
  const [pies, setPies] = useState<PieLike[] | null>(seeded ?? piesCache);
  useEffect(() => {
    if (seeded) {
      piesCache = seeded; // let other consumers reuse it, no network call
      setPies(seeded);
      return;
    }
    if (piesCache) {
      setPies(piesCache);
      return;
    }
    let cancelled = false;
    if (!piesPromise) {
      piesPromise = fetchPiesOnce()
        .then((p) => {
          piesCache = p;
          return p;
        })
        .catch((e) => {
          piesPromise = null; // allow a later mount to retry
          throw e;
        });
    }
    piesPromise.then((p) => !cancelled && setPies(p)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [seeded]);
  return seeded ?? pies;
}

/** Total current value of a ticker across all pies — the denominator for its real
 *  per-pie share (a ticker held in several pies splits by these actual values). */
export function pieValueByTicker(pies: PieLike[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pies) for (const ins of p.instruments) m.set(ins.ticker, (m.get(ins.ticker) ?? 0) + ins.value);
  return m;
}

export interface TickerSplit {
  categoryIndex: number;
  name: string;
  color: string;
  fraction: number; // share of this ticker's holding attributed to this category (splits sum to 1)
}

/**
 * How each T212 ticker's holding splits across the categories it belongs to.
 * A ticker can live in several categories; its position is divided in proportion
 * to each category's intended euro share of it (categoryTarget% × memberWeight%),
 * so a holding is never double-counted and category values reconcile to the total.
 */
export function tickerSplits(categories: AllocationCategory[]): Map<string, TickerSplit[]> {
  const raw = new Map<string, { idx: number; intent: number }[]>();
  categories.forEach((c, idx) => {
    for (const m of c.members) {
      if (!m.t212Ticker) continue;
      const intent = Math.max(0, c.targetPct) * Math.max(0, m.weightPct); // relative euro intent
      const arr = raw.get(m.t212Ticker) ?? [];
      arr.push({ idx, intent });
      raw.set(m.t212Ticker, arr);
    }
  });
  const out = new Map<string, TickerSplit[]>();
  for (const [ticker, arr] of raw) {
    const sum = arr.reduce((a, x) => a + x.intent, 0);
    out.set(
      ticker,
      arr.map((x) => ({
        categoryIndex: x.idx,
        name: categories[x.idx].name,
        color: CATEGORY_COLORS[x.idx % CATEGORY_COLORS.length],
        fraction: sum > 0 ? x.intent / sum : 1 / arr.length, // equal split if intents are all zero
      })),
    );
  }
  return out;
}

/** T212 ticker → its dominant category (for a single chip colour on tables/charts). */
export function tickerCategoryIndex(categories: AllocationCategory[]): Map<string, CategoryLookup> {
  const map = new Map<string, CategoryLookup>();
  for (const [ticker, splits] of tickerSplits(categories)) {
    const best = splits.reduce((a, b) => (b.fraction > a.fraction ? b : a));
    map.set(ticker, { name: best.name, color: best.color, index: best.categoryIndex });
  }
  return map;
}

export interface CategorySlice {
  name: string;
  value: number;
  color: string;
  targetPct: number | null; // null for the Unassigned bucket
}

/** Portfolio value grouped by category, plus an Unassigned bucket. */
export function groupByCategory(categories: AllocationCategory[], positions: Position[]): CategorySlice[] {
  const splits = tickerSplits(categories);
  const values = categories.map(() => 0);
  let unassigned = 0;
  for (const p of positions) {
    const sp = splits.get(p.instrument.ticker);
    if (sp && sp.length) {
      for (const s of sp) values[s.categoryIndex] += p.walletImpact.currentValue * s.fraction;
    } else unassigned += p.walletImpact.currentValue;
  }
  const slices: CategorySlice[] = categories.map((c, i) => ({
    name: c.name,
    value: values[i],
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    targetPct: c.targetPct,
  }));
  if (unassigned > 0.005) slices.push({ name: "Unassigned", value: unassigned, color: UNASSIGNED_COLOR, targetPct: null });
  return slices.filter((s) => s.value > 0 || s.targetPct != null);
}

/**
 * Category slices with real Trading212 pie values when a category matches a pie
 * (exact, no shared-ticker guessing), falling back to the reconstructed split
 * per-category when no pie matches or pies are unavailable. The Unassigned bucket
 * always stays reconstructed (no pie backs it). Single source of truth so every
 * surface — donut, overview bars, breakdown, planner — shows the same numbers.
 */
export function categorySlices(categories: AllocationCategory[], positions: Position[], pies: PieLike[] | null): CategorySlice[] {
  const base = groupByCategory(categories, positions);
  if (!pies || pies.length === 0) return base;
  const pieMap = piesByCategoryName(pies);
  return base.map((s) => {
    if (s.targetPct == null) return s; // Unassigned — no pie backs it
    const pie = pieMap.get(normalizePieName(s.name));
    return pie ? { ...s, value: pie.value } : s;
  });
}
