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
  return { categories: [], deposit: 500 };
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

/** T212 ticker → category (name + stable color by category order). */
export function tickerCategoryIndex(categories: AllocationCategory[]): Map<string, CategoryLookup> {
  const map = new Map<string, CategoryLookup>();
  categories.forEach((c, index) => {
    for (const m of c.members) {
      if (m.t212Ticker) map.set(m.t212Ticker, { name: c.name, color: CATEGORY_COLORS[index % CATEGORY_COLORS.length], index });
    }
  });
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
  const lookup = tickerCategoryIndex(categories);
  const values = categories.map(() => 0);
  let unassigned = 0;
  for (const p of positions) {
    const hit = lookup.get(p.instrument.ticker);
    if (hit) values[hit.index] += p.walletImpact.currentValue;
    else unassigned += p.walletImpact.currentValue;
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
