"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, prettyTicker } from "@/lib/analytics";
import type { Position } from "@/lib/types";
import { loadAllocation, saveAllocation, tickerSplits, piesByCategoryName, normalizePieName, categoriesFromPies, usePies, type AllocationCategory as Category, type AllocationMember as Member, type PieLike } from "@/lib/allocation";

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * No-sell rebalance: the deposit fills underweight categories first.
 * target_i = (total + deposit) · pct_i; need_i = max(0, target_i − current_i).
 * If the deposit can't cover all needs, it's split proportionally to need;
 * any surplus after all needs are met is split by target percentage.
 */
function rebalanceDeposit(deposit: number, currents: number[], pcts: number[]): number[] {
  const pctSum = pcts.reduce((a, b) => a + b, 0);
  if (deposit <= 0 || pctSum <= 0) return pcts.map(() => 0);
  const norm = pcts.map((p) => p / pctSum);
  const total = currents.reduce((a, b) => a + b, 0) + deposit;
  const needs = norm.map((p, i) => Math.max(0, total * p - currents[i]));
  const needSum = needs.reduce((a, b) => a + b, 0);
  if (needSum <= 0) return norm.map((p) => deposit * p);
  if (needSum >= deposit) return needs.map((n) => (deposit * n) / needSum);
  const surplus = deposit - needSum;
  return needs.map((n, i) => n + surplus * norm[i]);
}

export default function AllocationPlanner({ positions, currency, pies: piesProp }: { positions: Position[]; currency: string; pies?: PieLike[] }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [deposit, setDeposit] = useState<number>(500);
  const [newName, setNewName] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const s = loadAllocation();
    setCategories(s.categories);
    setDeposit(s.deposit);
  }, []);

  const persist = useCallback((cats: Category[], dep: number) => {
    setCategories(cats);
    setDeposit(dep);
    saveAllocation({ categories: cats, deposit: dep });
  }, []);

  const pies = usePies(piesProp);

  // Categories come live from the Trading212 pies (source of truth). The saved
  // localStorage allocation is only an offline fallback / manual mode when there
  // are no pies. In pie-driven mode the categories are read-only.
  const pieCategories = useMemo(() => (pies && pies.length ? categoriesFromPies(pies) : null), [pies]);
  const pieDriven = pieCategories !== null;
  const effCategories = pieCategories ?? categories;

  const holdingValue = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of positions) map.set(p.instrument.ticker, p.walletImpact.currentValue);
    return map;
  }, [positions]);

  const assignedTickers = useMemo(() => new Set(effCategories.flatMap((c) => c.members.map((m) => m.t212Ticker).filter(Boolean))), [effCategories]);
  const unassignedHoldings = positions.filter((p) => !assignedTickers.has(p.instrument.ticker));

  // Real current value per category: the matching Trading212 pie when we have it
  // (exact), else each member's holding scaled by this category's share of it so a
  // ticker in several categories is never double-counted.
  const catValues = useMemo(() => {
    const pieMap = pies ? piesByCategoryName(pies) : new Map<string, PieLike>();
    const splits = tickerSplits(effCategories);
    return effCategories.map((c, i) => {
      const pie = pieMap.get(normalizePieName(c.name));
      if (pie) return pie.value; // exact, from the real Trading212 pie
      return c.members.reduce((a, m) => {
        if (!m.t212Ticker) return a;
        const frac = splits.get(m.t212Ticker)?.find((s) => s.categoryIndex === i)?.fraction ?? 1;
        return a + (holdingValue.get(m.t212Ticker) ?? 0) * frac;
      }, 0);
    });
  }, [effCategories, holdingValue, pies]);

  const catValueAt = useCallback((i: number) => catValues[i] ?? 0, [catValues]);

  const totalAssigned = useMemo(() => catValues.reduce((a, b) => a + b, 0), [catValues]);
  const pctSum = effCategories.reduce((a, c) => a + c.targetPct, 0);

  const plan = useMemo(() => {
    const currents = catValues;
    const amounts = rebalanceDeposit(deposit, currents, effCategories.map((c) => c.targetPct));
    const totalAfter = currents.reduce((a, b) => a + b, 0) + amounts.reduce((a, b) => a + b, 0);
    return effCategories.map((c, i) => {
      const wSum = c.members.reduce((a, m) => a + m.weightPct, 0);
      return {
        category: c,
        current: currents[i],
        currentPct: totalAssigned > 0 ? currents[i] / totalAssigned : 0,
        afterPct: totalAfter > 0 ? (currents[i] + amounts[i]) / totalAfter : 0,
        amount: amounts[i],
        members: c.members.map((m) => ({
          member: m,
          amount: wSum > 0 ? (amounts[i] * m.weightPct) / wSum : c.members.length > 0 ? amounts[i] / c.members.length : 0,
        })),
      };
    });
  }, [effCategories, deposit, catValues, totalAssigned]);

  const addCategory = () => {
    const name = newName.trim();
    if (!name) return;
    const remaining = Math.max(0, 100 - pctSum);
    persist([...categories, { id: uid(), name, targetPct: remaining, members: [] }], deposit);
    setNewName("");
  };

  const patchCategory = (id: string, patch: Partial<Category>) =>
    persist(categories.map((c) => (c.id === id ? { ...c, ...patch } : c)), deposit);

  const removeCategory = (id: string) => persist(categories.filter((c) => c.id !== id), deposit);

  const addMember = (catId: string, member: Omit<Member, "weightPct">) => {
    persist(
      categories.map((c) => {
        if (c.id !== catId || c.members.some((m) => m.id === member.id)) return c;
        const n = c.members.length + 1;
        const w = Math.round(100 / n);
        // re-balance existing weights to make room, keeping it summing near 100
        const members = [...c.members.map((m) => ({ ...m, weightPct: Math.round((m.weightPct * (n - 1)) / n) })), { ...member, weightPct: w }];
        return { ...c, members };
      }),
      deposit,
    );
    setPickerFor(null);
    setQuery("");
    setResults([]);
  };

  const patchMember = (catId: string, memberId: string, weightPct: number) =>
    persist(
      categories.map((c) => (c.id === catId ? { ...c, members: c.members.map((m) => (m.id === memberId ? { ...m, weightPct } : m)) } : c)),
      deposit,
    );

  const removeMember = (catId: string, memberId: string) =>
    persist(categories.map((c) => (c.id === catId ? { ...c, members: c.members.filter((m) => m.id !== memberId) } : c)), deposit);

  const runSearch = (q: string) => {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stock-search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      }
    }, 350);
  };

  return (
    <div className="space-y-6">
      {/* Live categories from the Trading212 pies — the source of truth (read-only). */}
      {pieDriven && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">Categories from your Trading212 pies</span>
            <span className="num text-xs text-muted-2">source of truth · targets {pctSum.toFixed(0)}%</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-2">Each pie is a category — names, targets and holdings come live from Trading212. Manage them in the Trading212 app.</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {effCategories.map((c, i) => {
              const value = catValueAt(i);
              return (
                <div key={c.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                    <span className="num shrink-0 text-xs text-muted">{c.targetPct.toFixed(0)}%</span>
                  </div>
                  <div className="num mt-1 text-xs text-muted-2">
                    {formatMoney(value, currency)}
                    {totalAssigned > 0 && ` · ${((value / totalAssigned) * 100).toFixed(1)}% of pies`}
                  </div>
                  <ul className="mt-3 space-y-1">
                    {c.members.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <span className="num shrink-0 text-muted-2">{m.weightPct.toFixed(0)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Manual category manager — only when there are no live pies (offline fallback). */}
      {!pieDriven && (
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCategory()}
            placeholder="New category — e.g. Dividend ETFs, Growth, REITs"
            className="w-full max-w-xs rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted-2 focus:border-[var(--primary)]"
          />
          <button onClick={addCategory} className="rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-card-hover">
            Add category
          </button>
          <span className={`num ml-auto text-xs ${Math.round(pctSum) === 100 ? "text-accent" : "text-red"}`}>
            targets {pctSum.toFixed(0)}%{Math.round(pctSum) !== 100 && " — should sum to 100%"}
          </span>
        </div>

        {categories.length === 0 && (
          <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-2">
            Create categories, drop your stocks & ETFs into them, give each a target percentage — then the calculator below splits any deposit.
          </p>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {categories.map((c, i) => {
            const value = catValueAt(i);
            const wSum = c.members.reduce((a, m) => a + m.weightPct, 0);
            return (
              <div key={c.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center gap-2">
                  <input
                    value={c.name}
                    onChange={(e) => patchCategory(c.id, { name: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                  />
                  <label className="num flex items-center gap-1 text-xs text-muted">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={c.targetPct}
                      onChange={(e) => patchCategory(c.id, { targetPct: Number(e.target.value) })}
                      className="w-14 rounded-lg border border-border bg-card px-1.5 py-1 text-right outline-none focus:border-[var(--primary)]"
                    />
                    %
                  </label>
                  <button onClick={() => removeCategory(c.id)} className="text-xs text-muted-2 hover:text-red" title="Delete category">
                    ✕
                  </button>
                </div>
                <div className="num mt-1 text-xs text-muted-2">
                  current value {formatMoney(value, currency)}
                  {totalAssigned > 0 && ` · ${((value / totalAssigned) * 100).toFixed(1)}% of assigned`}
                </div>

                <ul className="mt-3 space-y-1.5">
                  {c.members.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">
                        {m.name} <span className="num text-muted-2">{m.t212Ticker ? prettyTicker(m.t212Ticker) : m.id}</span>
                        {!m.t212Ticker && <span className="ml-1 rounded bg-card px-1 py-0.5 text-[10px] text-muted-2">not held</span>}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        value={m.weightPct}
                        onChange={(e) => patchMember(c.id, m.id, Number(e.target.value))}
                        className="num w-14 rounded-lg border border-border bg-card px-1.5 py-0.5 text-right outline-none focus:border-[var(--primary)]"
                        title="Weight inside this category"
                      />
                      <span className="text-muted-2">%</span>
                      <button onClick={() => removeMember(c.id, m.id)} className="text-muted-2 hover:text-red">
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
                {c.members.length > 0 && Math.round(wSum) !== 100 && (
                  <div className="num mt-1 text-[10px] text-muted-2">weights sum to {wSum.toFixed(0)}% — used proportionally</div>
                )}

                {pickerFor === c.id ? (
                  <div className="relative mt-2">
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => runSearch(e.target.value)}
                      placeholder="Search any stock/ETF, or pick a holding below"
                      className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-2 focus:border-[var(--primary)]"
                    />
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-card">
                      {results.map((r) => (
                        <button
                          key={r.symbol}
                          onClick={() => addMember(c.id, { id: r.symbol, name: r.name })}
                          className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-card-hover"
                        >
                          <span className="truncate">{r.name}</span>
                          <span className="num shrink-0 text-muted-2">{r.symbol}</span>
                        </button>
                      ))}
                      {query.trim().length < 2 &&
                        unassignedHoldings.map((p) => (
                          <button
                            key={p.instrument.ticker}
                            onClick={() => addMember(c.id, { id: p.instrument.ticker, name: p.instrument.name, t212Ticker: p.instrument.ticker })}
                            className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-card-hover"
                          >
                            <span className="truncate">{p.instrument.name}</span>
                            <span className="num shrink-0 text-muted-2">
                              {prettyTicker(p.instrument.ticker)} · {formatMoney(p.walletImpact.currentValue, currency, 0)}
                            </span>
                          </button>
                        ))}
                      {query.trim().length < 2 && unassignedHoldings.length === 0 && (
                        <div className="px-2.5 py-1.5 text-xs text-muted-2">All holdings assigned — type to search any stock.</div>
                      )}
                    </div>
                    <button onClick={() => setPickerFor(null)} className="mt-1 text-[11px] text-muted-2 hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setPickerFor(c.id)} className="mt-2 text-xs font-medium text-primary hover:underline">
                    + Add stock / ETF
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Deposit calculator */}
      {effCategories.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold">Deposit calculator</span>
            <label className="num flex items-center gap-1.5 text-sm">
              <input
                type="number"
                min={0}
                step="any"
                value={deposit}
                onChange={(e) => persist(categories, Number(e.target.value))}
                className="w-28 rounded-lg border border-border bg-card px-2.5 py-1.5 text-right outline-none focus:border-[var(--primary)]"
              />
              {currency}
            </label>
            <span className="text-xs text-muted-2">
              Rebalance-aware: underweight categories are filled first, so your portfolio drifts toward the targets without selling.
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-2">
                  <th className="pb-2 font-medium">Category / stock</th>
                  <th className="pb-2 text-right font-medium">Now</th>
                  <th className="pb-2 text-right font-medium">Target</th>
                  <th className="pb-2 text-right font-medium">After deposit</th>
                  <th className="pb-2 text-right font-medium">Invest</th>
                </tr>
              </thead>
              <tbody>
                {plan.map(({ category: c, currentPct, afterPct, amount, members }) => (
                  <React.Fragment key={c.id}>
                    <tr className="border-t border-border">
                      <td className="py-2 font-medium">{c.name}</td>
                      <td className="num py-2 text-right text-muted">{(currentPct * 100).toFixed(1)}%</td>
                      <td className="num py-2 text-right text-muted">{c.targetPct.toFixed(0)}%</td>
                      <td className="num py-2 text-right text-muted">{(afterPct * 100).toFixed(1)}%</td>
                      <td className="num py-2 text-right font-semibold text-primary">{formatMoney(amount, currency)}</td>
                    </tr>
                    {members.map(({ member: m, amount: ma }) => (
                      <tr key={m.id} className="text-xs text-muted">
                        <td className="py-1 pl-4">
                          {m.name} <span className="num text-muted-2">{m.t212Ticker ? prettyTicker(m.t212Ticker) : m.id}</span>
                        </td>
                        <td />
                        <td className="num py-1 text-right">{m.weightPct.toFixed(0)}% of cat.</td>
                        <td />
                        <td className="num py-1 text-right">{formatMoney(ma, currency)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr className="border-t border-border text-xs">
                  <td className="py-2 text-muted">Unassigned holdings stay untouched</td>
                  <td className="num py-2 text-right text-muted-2" colSpan={3}>
                    {unassignedHoldings.length > 0
                      ? `${unassignedHoldings.length} holding${unassignedHoldings.length === 1 ? "" : "s"} outside categories`
                      : "all holdings categorised"}
                  </td>
                  <td className="num py-2 text-right font-semibold">{formatMoney(plan.reduce((a, p) => a + p.amount, 0), currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
