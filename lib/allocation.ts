"use client";

// Shared access to the user's category allocation (created on the dashboard
// Allocation tab, persisted in localStorage). Same-tab consumers stay in sync
// via the "allocation-changed" window event; other tabs via the storage event.

import { useEffect, useState } from "react";
import type { Position } from "@/lib/types";

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
  invested: number;
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
