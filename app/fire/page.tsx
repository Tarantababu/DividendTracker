"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import { formatMoney } from "@/lib/analytics";
import { DEFAULT_GERMAN_TAX, combinedTaxRate, type GermanTaxSettings } from "@/lib/tax";
import GermanTaxControls from "@/components/GermanTaxControls";
import { FIRE_TYPES, fireTarget, projectFire, type FireProjection, type FireType } from "@/lib/fire";
import type { FirePayload } from "@/app/api/fire/route";
import StatCard from "@/components/StatCard";

const STORAGE_KEY = "dividend-tracker-fire-v1";

interface FireSettings {
  fireType: FireType;
  monthlyExpenses: number | null; // null = use the default below
  withdrawalRatePct: number;
  annualReturnPct: number | null; // null = use XIRR
  monthlyContribution: number | null; // null = auto (T212 12M average)
  leanPct: number; // Lean expenses as % of base
  fatMultiple: number; // Fat expenses multiple
  baristaMonthlyIncome: number; // side income for Barista FIRE
  coastYears: number; // years until drawdown, for Coast FIRE
  inflationPct: number; // projection runs in today's money
  reinvestDividends: boolean; // compound dividends (net of tax) instead of spending them
  tax: GermanTaxSettings; // same model the simulator uses
}

const FALLBACK_EXPENSES = 4285; // used when the user hasn't set a value

const DEFAULTS: FireSettings = {
  fireType: "regular",
  monthlyExpenses: 4285,
  withdrawalRatePct: 5,
  annualReturnPct: 14,
  monthlyContribution: 1400,
  leanPct: 60,
  fatMultiple: 2,
  baristaMonthlyIncome: 1000,
  coastYears: 15,
  inflationPct: 2,
  reinvestDividends: true,
  tax: DEFAULT_GERMAN_TAX,
};

function num(v: string): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

export default function FirePage() {
  const [data, setData] = useState<FirePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lazy init from localStorage; nothing settings-dependent is rendered before data loads, so hydration stays consistent
  const [settings, setSettings] = useState<FireSettings>(() => {
    if (typeof window === "undefined") return DEFAULTS;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FireSettings>;
        const s = { ...DEFAULTS, ...parsed, tax: { ...DEFAULT_GERMAN_TAX, ...(parsed.tax ?? {}) } };
        return s;
      }
    } catch {
      /* defaults are fine */
    }
    return DEFAULTS;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fire");
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.message ?? "Could not load FIRE data");
        if (!cancelled) setData(payload as FirePayload);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Fall back to measured values where the user hasn't overridden.
  const effReturn = settings.annualReturnPct ?? (data?.xirrPct !== null && data?.xirrPct !== undefined ? Math.min(12, Math.max(0, data.xirrPct)) : 6);
  // Every input is either the user's own value or a default — deliberately no
  // budget/N26 dependency, so this page never waits on the bank cache.
  const effExpenses = settings.monthlyExpenses ?? FALLBACK_EXPENSES;
  const effContribution = settings.monthlyContribution ?? Math.max(0, Math.round(data?.monthlyContribution12m ?? 0));
  const yieldPct = data && data.totalValue > 0 ? (data.dividends12m / data.totalValue) * 100 : 0;

  // Project every FIRE type; the selected one drives the chart, all of them fill the comparison table
  const projections = useMemo(() => {
    if (!data) return null;
    const ti = {
      monthlyExpenses: effExpenses,
      withdrawalRatePct: settings.withdrawalRatePct,
      annualReturnPct: effReturn,
      portfolioYieldPct: yieldPct,
      leanPct: settings.leanPct,
      fatMultiple: settings.fatMultiple,
      baristaMonthlyIncome: settings.baristaMonthlyIncome,
      coastYears: settings.coastYears,
      inflationPct: settings.inflationPct,
      tax: settings.tax,
    };
    const out = {} as Record<FireType, FireProjection>;
    for (const t of FIRE_TYPES) {
      const target = fireTarget(t.key, ti);
      out[t.key] = projectFire({
        currentValue: data.totalValue,
        monthlyContribution: effContribution,
        annualReturnPct: effReturn,
        target,
        incomeRatePct: t.key === "dividend" ? yieldPct : settings.withdrawalRatePct,
        inflationPct: settings.inflationPct,
        dividendYieldPct: yieldPct,
        reinvestDividends: settings.reinvestDividends,
        dividendTax: settings.tax,
      });
    }
    return out;
    // Every setting the projection reads must be listed, or changing it silently
    // does nothing: inflation and the reinvest toggle were missing, which is why
    // flipping "Reinvested" appeared to have no effect on the ETA.
  }, [
    data,
    effContribution,
    effReturn,
    yieldPct,
    effExpenses,
    settings.withdrawalRatePct,
    settings.leanPct,
    settings.fatMultiple,
    settings.baristaMonthlyIncome,
    settings.coastYears,
    settings.inflationPct,
    settings.reinvestDividends,
    settings.tax,
  ]);

  const cur = data?.currency ?? "EUR";
  const typeConfig = FIRE_TYPES.find((t) => t.key === settings.fireType)!;
  const projection = projections?.[settings.fireType] ?? null;
  const coverage = data && effExpenses > 0 ? data.dividendsMonthly12m / effExpenses : 0;
  const yearsToTarget = projection?.monthsToTarget != null ? projection.monthsToTarget / 12 : null;

  const setType = (t: FireType) => setSettings((s) => ({ ...s, fireType: t }));

  if (error) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-red">{error}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-bold tracking-tight">FIRE progress</h1>
      <p className="mt-1 text-sm text-muted">
        Financial independence tracker — real deposits, real returns, projected forward
        {data?.firstFlowDate && <span> · cashflow history since {data.firstFlowDate}</span>}
      </p>

      {!data && <div className="mt-8 flex h-40 items-center justify-center text-sm text-muted-2">Crunching your cashflow history…</div>}

      {data && projection && projections && (
        <>
          {/* FIRE type selector */}
          <div className="mt-5 flex flex-wrap gap-1.5">
            {FIRE_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  settings.fireType === t.key ? "bg-[var(--primary)] text-[var(--primary-fg)]" : "border border-border bg-card text-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {typeConfig.blurb}
            {settings.fireType === "dividend" && <span className="text-accent"> Your portfolio yields {yieldPct.toFixed(2)}%/yr.</span>}
          </p>

          {/* Type-specific input */}
          {settings.fireType !== "regular" && (
            <div className="mt-3 rounded-xl border border-border bg-card p-3">
              <label className="flex flex-wrap items-center gap-2 text-xs">
                {settings.fireType === "lean" && (
                  <>
                    <span className="font-medium text-muted">Lean expenses (% of full)</span>
                    <input type="number" min={10} max={100} step={5} value={settings.leanPct} onChange={(e) => setSettings((s) => ({ ...s, leanPct: num(e.target.value) }))} className="w-24 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" />
                    <span className="text-muted-2">= {formatMoney((effExpenses * settings.leanPct) / 100, cur, 0)}/mo</span>
                  </>
                )}
                {settings.fireType === "fat" && (
                  <>
                    <span className="font-medium text-muted">Fat expenses multiple (×)</span>
                    <input type="number" min={1} step={0.25} value={settings.fatMultiple} onChange={(e) => setSettings((s) => ({ ...s, fatMultiple: num(e.target.value) }))} className="w-24 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" />
                    <span className="text-muted-2">= {formatMoney(effExpenses * settings.fatMultiple, cur, 0)}/mo</span>
                  </>
                )}
                {settings.fireType === "barista" && (
                  <>
                    <span className="font-medium text-muted">Part-time income ({cur}/mo)</span>
                    <input type="number" min={0} step={100} value={settings.baristaMonthlyIncome} onChange={(e) => setSettings((s) => ({ ...s, baristaMonthlyIncome: Math.max(0, num(e.target.value)) }))} className="w-28 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" />
                    <span className="text-muted-2">portfolio covers {formatMoney(Math.max(0, effExpenses - settings.baristaMonthlyIncome), cur, 0)}/mo</span>
                  </>
                )}
                {settings.fireType === "coast" && (
                  <>
                    <span className="font-medium text-muted">Years until you draw down</span>
                    <input type="number" min={1} max={50} step={1} value={settings.coastYears} onChange={(e) => setSettings((s) => ({ ...s, coastYears: Math.max(1, num(e.target.value)) }))} className="w-24 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" />
                    <span className="text-muted-2">then compounding alone reaches Regular FIRE</span>
                  </>
                )}
                {settings.fireType === "dividend" && <span className="text-muted-2">Target = annual expenses ÷ current portfolio yield ({yieldPct.toFixed(2)}%). Progress equals dividend coverage.</span>}
              </label>
            </div>
          )}

          {/* Headline stats */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={`${typeConfig.label} number`} value={formatMoney(projection.target, cur, 0)} sub={settings.fireType === "dividend" ? `dividends must cover ${formatMoney(effExpenses, cur, 0)}/mo` : `${formatMoney(effExpenses, cur, 0)}/mo at ${settings.withdrawalRatePct}% SWR`} tone="primary" />
            <StatCard
              label="Progress"
              value={`${(projection.progressPct * 100).toFixed(1)}%`}
              sub={`${formatMoney(data.totalValue, cur, 0)} of ${formatMoney(projection.target, cur, 0)}`}
              tone="accent"
            />
            <StatCard
              label="True growth"
              value={formatMoney(data.growth, cur, 0)}
              sub={`on ${formatMoney(data.netContributions, cur, 0)} net contributions`}
              tone={data.growth >= 0 ? "positive" : "negative"}
            />
            <StatCard
              label="Money-weighted return"
              value={data.xirrPct === null ? "n/a" : `${data.xirrPct.toFixed(1)}%/yr`}
              sub="XIRR — deposits stripped out"
              tone={data.xirrPct !== null && data.xirrPct >= 0 ? "positive" : "negative"}
            />
          </div>

          {/* Progress bar */}
          <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">
                {yearsToTarget === null && `${typeConfig.label} not reachable within 60 years on current settings`}
                {yearsToTarget !== null && yearsToTarget === 0 && `You've reached ${typeConfig.label} 🎉`}
                {yearsToTarget !== null && yearsToTarget > 0 && (
                  <>
                    {typeConfig.label} in ~{yearsToTarget.toFixed(1)} years <span className="font-normal text-muted">({projection.targetDate})</span>
                  </>
                )}
              </span>
              <span className="num text-xs text-muted">
                dividends cover <span className="font-semibold text-accent">{(coverage * 100).toFixed(1)}%</span> of expenses (
                {formatMoney(data.dividendsMonthly12m, cur)}/mo trailing 12M)
              </span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] transition-all"
                style={{ width: `${Math.min(100, projection.progressPct * 100)}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-muted-2">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100% — {formatMoney(projection.target, cur, 0)}</span>
            </div>
          </div>

          {/* All FIRE types compared */}
          <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <h2 className="text-sm font-semibold tracking-wide">FIRE types compared</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-2">
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 text-right font-medium">Target</th>
                  <th className="pb-2 text-right font-medium">Progress</th>
                  <th className="pb-2 text-right font-medium">ETA</th>
                </tr>
              </thead>
              <tbody>
                {FIRE_TYPES.map((t) => {
                  const p = projections[t.key];
                  const yrs = p.monthsToTarget != null ? p.monthsToTarget / 12 : null;
                  const active = t.key === settings.fireType;
                  return (
                    <tr
                      key={t.key}
                      onClick={() => setType(t.key)}
                      className={`cursor-pointer border-t border-border-soft transition-colors hover:bg-card-hover ${active ? "bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]" : ""}`}
                    >
                      <td className="py-2 font-medium">
                        {active && <span className="mr-1 text-[var(--primary)]">▸</span>}
                        {t.label}
                      </td>
                      <td className="num py-2 text-right">{formatMoney(p.target, cur, 0)}</td>
                      <td className="num py-2 text-right text-accent">{(p.progressPct * 100).toFixed(1)}%</td>
                      <td className="num py-2 text-right text-muted">{yrs === null ? "60y+" : yrs === 0 ? "reached ✓" : `${yrs.toFixed(1)}y`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Assumptions */}
          <div className="mt-4 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs">
              <span className="font-medium text-muted">Monthly expenses ({cur})</span>
              <input
                type="number"
                min={0}
                value={settings.monthlyExpenses ?? effExpenses}
                onChange={(e) => setSettings((s) => ({ ...s, monthlyExpenses: num(e.target.value) }))}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              />
              <span className="mt-0.5 block text-[10px] text-muted-2">
                {settings.monthlyExpenses == null ? (
                  `default ${formatMoney(FALLBACK_EXPENSES, cur, 0)}/mo`
                ) : (
                  <button className="underline" onClick={() => setSettings((s) => ({ ...s, monthlyExpenses: null }))}>reset to default</button>
                )}
              </span>
            </label>
            <label className="block text-xs">
              <span className="font-medium text-muted">Withdrawal rate (%/yr)</span>
              <input
                type="number"
                min={0.5}
                step={0.25}
                value={settings.withdrawalRatePct}
                onChange={(e) => setSettings((s) => ({ ...s, withdrawalRatePct: Math.max(0.5, num(e.target.value)) }))}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-muted">Inflation (%/yr)</span>
              <input
                type="number"
                min={0}
                step={0.25}
                value={settings.inflationPct}
                onChange={(e) => setSettings((s) => ({ ...s, inflationPct: Math.max(0, num(e.target.value)) }))}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              />
              <span className="mt-0.5 block text-[10px] text-muted-2">Everything is shown in today&apos;s money</span>
            </label>
            <label className="block text-xs">
              <span className="font-medium text-muted">Expected return (%/yr)</span>
              <input
                type="number"
                step={0.5}
                value={settings.annualReturnPct ?? effReturn.toFixed(1)}
                onChange={(e) => setSettings((s) => ({ ...s, annualReturnPct: num(e.target.value) }))}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              />
              <span className="mt-0.5 block text-[10px] text-muted-2">
                {settings.annualReturnPct === null ? "auto: your XIRR, clamped to 0–12%" : <button className="underline" onClick={() => setSettings((s) => ({ ...s, annualReturnPct: null }))}>reset to measured XIRR</button>}
              </span>
            </label>
            <label className="block text-xs">
              <span className="font-medium text-muted">Monthly contribution ({cur})</span>
              <input
                type="number"
                min={0}
                value={settings.monthlyContribution ?? effContribution}
                onChange={(e) => setSettings((s) => ({ ...s, monthlyContribution: Math.max(0, num(e.target.value)) }))}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              />
              <span className="mt-0.5 block text-[10px] text-muted-2">
                {settings.monthlyContribution === null ? (
                  `auto: your T212 12M average (${formatMoney(data.monthlyContribution12m, cur, 0)}/mo)`
                ) : (
                  <button className="underline" onClick={() => setSettings((s) => ({ ...s, monthlyContribution: null }))}>reset to auto</button>
                )}
              </span>
            </label>
            <label className="block text-xs">
              <span className="font-medium text-muted">Dividends</span>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, reinvestDividends: !s.reinvestDividends }))}
                className="mt-1 flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              >
                <span>{settings.reinvestDividends ? "Reinvested" : "Taken as cash"}</span>
                <span
                  className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${settings.reinvestDividends ? "bg-[var(--accent)]" : "bg-border-strong"}`}
                >
                  <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${settings.reinvestDividends ? "left-3.5" : "left-0.5"}`} />
                </span>
              </button>
              <span className="mt-0.5 block text-[10px] text-muted-2">
                {settings.reinvestDividends
                  ? settings.tax.enabled
                    ? `compounding after tax — ${(combinedTaxRate(settings.tax) * (1 - settings.tax.partialExemptionPct / 100) * 100).toFixed(1)}% effective`
                    : "compounding untaxed (tax disabled below)"

                  : "spent, so they never compound"}
              </span>
            </label>
          </div>

          {/* Same German tax model as the simulator, so both pages agree. */}
          <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <h2 className="text-sm font-semibold tracking-wide">German tax</h2>
            <p className="mt-0.5 mb-3 text-xs text-muted-2">
              Targets are sized on the income needed <em>after</em> tax, and reinvested dividends compound net of it.
            </p>
            <GermanTaxControls value={settings.tax} onChange={(tax) => setSettings((s) => ({ ...s, tax }))} />
          </div>

          {/* Projection chart */}
          <section className="mt-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <h2 className="text-sm font-semibold tracking-wide">Path to {typeConfig.label}</h2>
            <p className="mt-0.5 text-xs text-muted-2">
              {effReturn.toFixed(1)}%/yr return · {formatMoney(effContribution, cur, 0)}/mo contributions · nominal, before tax
            </p>
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={projection.points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="fireFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "var(--muted-2)", fontSize: 11 }} minTickGap={50} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "var(--muted-2)", fontSize: 11 }}
                    tickFormatter={(v: number) => formatMoney(v, cur, 0)}
                    width={80}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) => [formatMoney(Number(v), cur, 0), name === "value" ? "Portfolio" : "Contributed (future)"]}
                  />
                  <ReferenceLine
                    y={projection.target}
                    stroke="var(--accent)"
                    strokeDasharray="6 4"
                    label={{ value: `${typeConfig.label} ${formatMoney(projection.target, cur, 0)}`, fill: "var(--accent)", fontSize: 11, position: "insideTopRight" }}
                  />
                  {projection.targetDate && <ReferenceLine x={projection.targetDate} stroke="var(--accent)" strokeDasharray="6 4" />}
                  <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={1.8} fill="url(#fireFill)" />
                  <Line type="monotone" dataKey="contributed" stroke="var(--muted-2)" strokeWidth={1.2} strokeDasharray="4 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[10px] text-muted-2">
              Dashed grey line: cumulative future contributions — the gap to the curve is compounding doing the work. German dividend tax not modelled here;
              the Simulator has full tax treatment.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
