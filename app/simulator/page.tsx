"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import { formatMoney, monthLabel, perTickerStats, prettyTicker } from "@/lib/analytics";
import type { DividendsPayload, OverviewPayload } from "@/lib/types";
import { DEFAULT_SIM_SETTINGS, runSimulation, type SimHolding, type SimSettings } from "@/lib/simulator";
import { DEFAULT_GERMAN_TAX } from "@/lib/tax";
import GermanTaxControls from "@/components/GermanTaxControls";

const STORAGE_KEY = "dividend-tracker-simulator";
const CUR = "EUR";

interface StoredScenario {
  holdings: SimHolding[];
  settings: SimSettings;
}

function num(v: string): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

export default function SimulatorPage() {
  const [holdings, setHoldings] = useState<SimHolding[]>([]);
  const [settings, setSettings] = useState<SimSettings>(DEFAULT_SIM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spreadAmount, setSpreadAmount] = useState("500");
  const [custom, setCustom] = useState({ ticker: "", yieldPct: "3.5" });

  const buildFromPortfolio = useCallback(async (): Promise<SimHolding[]> => {
    const [ovRes, divRes] = await Promise.all([fetch("/api/overview"), fetch("/api/dividends")]);
    if (!ovRes.ok || !divRes.ok) {
      const err = await (ovRes.ok ? divRes : ovRes).json();
      throw new Error(err.message ?? "Could not load portfolio");
    }
    const ov = (await ovRes.json()) as OverviewPayload;
    const div = (await divRes.json()) as DividendsPayload;
    const stats = new Map(perTickerStats(div.items, ov.positions).map((s) => [s.ticker, s]));
    return ov.positions
      .sort((a, b) => b.walletImpact.currentValue - a.walletImpact.currentValue)
      .map((p) => ({
        id: p.instrument.ticker,
        ticker: prettyTicker(p.instrument.ticker),
        name: p.instrument.name,
        startValue: Math.round(p.walletImpact.currentValue),
        monthlyDeposit: 0,
        yieldPct: Math.round((stats.get(p.instrument.ticker)?.yieldOnValue ?? 0) * 10000) / 100,
        dividendGrowthPct: 5,
        priceGrowthPct: 4,
      }));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as StoredScenario;
          if (stored.holdings?.length) {
            setHoldings(stored.holdings);
            setSettings({ ...DEFAULT_SIM_SETTINGS, ...stored.settings, tax: { ...DEFAULT_GERMAN_TAX, ...stored.settings?.tax } });
            return;
          }
        }
        setHoldings(await buildFromPortfolio());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [buildFromPortfolio]);

  useEffect(() => {
    if (!loading && holdings.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ holdings, settings } satisfies StoredScenario));
    }
  }, [holdings, settings, loading]);

  const result = useMemo(() => (holdings.length ? runSimulation(holdings, settings) : null), [holdings, settings]);
  const totalDeposit = holdings.reduce((s, h) => s + h.monthlyDeposit, 0);

  const patch = (id: string, p: Partial<SimHolding>) =>
    setHoldings((hs) => hs.map((h) => (h.id === id ? { ...h, ...p } : h)));

  const spread = (mode: "weight" | "even") => {
    const amount = num(spreadAmount);
    if (amount <= 0 || holdings.length === 0) return;
    const totalValue = holdings.reduce((s, h) => s + h.startValue, 0);
    setHoldings((hs) =>
      hs.map((h) => ({
        ...h,
        monthlyDeposit:
          mode === "even"
            ? Math.round(amount / hs.length)
            : Math.round(totalValue > 0 ? (amount * h.startValue) / totalValue : 0),
      })),
    );
  };

  const addCustom = () => {
    const t = custom.ticker.trim().toUpperCase();
    if (!t) return;
    const id = `custom-${t}-${Date.now()}`;
    setHoldings((hs) => [
      ...hs,
      { id, ticker: t, name: "Custom asset", startValue: 0, monthlyDeposit: 0, yieldPct: num(custom.yieldPct), dividendGrowthPct: 5, priceGrowthPct: 4 },
    ]);
    setCustom({ ticker: "", yieldPct: "3.5" });
  };

  const resetToPortfolio = async () => {
    setLoading(true);
    setError(null);
    try {
      setHoldings(await buildFromPortfolio());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const cellInput = "num w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm outline-none focus:border-muted-2";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Scenario simulator</h1>
          <p className="mt-0.5 text-xs text-muted-2">
            Tune allocation, monthly deposits and assumptions per holding — see the income and portfolio they produce
          </p>
        </div>
      </header>

      {loading && (
        <div className="flex min-h-64 items-center justify-center">
          <div className="animate-pulse text-sm text-muted">Loading your portfolio as the starting scenario…</div>
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-xl border border-[color-mix(in_srgb,var(--red)_30%,transparent)] bg-[color-mix(in_srgb,var(--red)_6%,transparent)] px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}

      {!loading && result && (
        <>
          {/* Results */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Monthly income{settings.tax.enabled ? " · net" : ""}</div>
              <div className="num mt-1.5 text-2xl font-semibold text-primary">{formatMoney(result.endMonthlyIncome, CUR, 0)}</div>
              <div className="num mt-1 text-xs text-muted">now {formatMoney(result.startMonthlyIncome, CUR, 0)} gross · in {settings.horizonYears} yrs</div>
            </div>
            <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Portfolio value</div>
              <div className="num mt-1.5 text-2xl font-semibold">{formatMoney(result.endValue, CUR, 0)}</div>
              <div className="num mt-1 text-xs text-muted">now {formatMoney(result.startValue, CUR, 0)}</div>
            </div>
            <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">You deposit</div>
              <div className="num mt-1.5 text-2xl font-semibold">{formatMoney(result.totalDeposited, CUR, 0)}</div>
              <div className="num mt-1 text-xs text-muted">{formatMoney(totalDeposit, CUR, 0)}/mo over {settings.horizonYears} yrs</div>
            </div>
            <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Dividends collected{settings.tax.enabled ? " · net" : ""}</div>
              <div className="num mt-1.5 text-2xl font-semibold text-accent">{formatMoney(result.totalDividends, CUR, 0)}</div>
              <div className="num mt-1 text-xs text-muted">
                {settings.reinvestDividends ? "reinvested" : "taken as cash"}
                {settings.tax.enabled && ` · tax paid ${formatMoney(result.totalTaxPaid, CUR, 0)}`}
              </div>
            </div>
          </div>

          {/* Chart */}
          <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide">Projection</h2>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted">
                  Horizon
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={settings.horizonYears}
                    onChange={(e) => setSettings((s) => ({ ...s, horizonYears: Math.max(1, Math.min(50, num(e.target.value))) }))}
                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    className="num w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm outline-none focus:border-muted-2"
                  />
                  yrs
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={settings.reinvestDividends}
                    onChange={(e) => setSettings((s) => ({ ...s, reinvestDividends: e.target.checked }))}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  Reinvest dividends
                </label>
              </div>
            </div>
            <div className="mb-4 max-w-xl">
              <GermanTaxControls value={settings.tax} onChange={(tax) => setSettings((s) => ({ ...s, tax }))} />
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={result.points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(d: string) => monthLabel(d)} minTickGap={40} />
                  <YAxis yAxisId="income" tick={{ fill: "var(--primary)", fontSize: 11 }} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => formatMoney(v, CUR, 0)} />
                  <YAxis yAxisId="value" orientation="right" tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatMoney(v, CUR, 0)} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(d) => monthLabel(String(d))}
                    formatter={(v, name) => [formatMoney(Number(v), CUR, 0), String(name)]}
                  />
                  <Area yAxisId="income" name="Monthly dividend income" type="monotone" dataKey="monthlyIncome" stroke="var(--primary)" strokeWidth={2} fill="url(#incGrad)" />
                  <Line yAxisId="value" name="Portfolio value" type="monotone" dataKey="portfolioValue" stroke="var(--accent)" strokeWidth={2} dot={false} />
                  <Line yAxisId="value" name="Deposited" type="monotone" dataKey="deposited" stroke="var(--muted-2)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-2">
              Left axis: monthly income{settings.tax.enabled ? " after German tax" : ""} (purple) · right axis: portfolio value (green) and cumulative
              deposits (dashed) · nominal figures
            </p>
          </section>

          {/* Editor */}
          <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-wide">Scenario</h2>
                <p className="mt-0.5 text-xs text-muted-2">
                  Yields prefilled from your actual trailing 12-month payouts · edit anything · deposits total {formatMoney(totalDeposit, CUR, 0)}/mo
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={spreadAmount}
                  onChange={(e) => setSpreadAmount(e.target.value)}
                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                  className="num w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm outline-none focus:border-muted-2"
                />
                <button onClick={() => spread("weight")} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground">
                  Spread by weight
                </button>
                <button onClick={() => spread("even")} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground">
                  Spread evenly
                </button>
                <button onClick={resetToPortfolio} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground">
                  Reset to my portfolio
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-border">
                  <tr>
                    {["Holding", "Start value", "Deposit / mo", "Yield %", "Div growth %", "Price growth %", ""].map((h, i) => (
                      <th key={i} className={`px-2 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-2 ${i === 0 ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => (
                    <tr key={h.id} className="border-b border-border-soft">
                      <td className="max-w-48 px-2 py-2">
                        <div className="font-medium">{h.ticker}</div>
                        <div className="truncate text-xs text-muted-2">{h.name}</div>
                      </td>
                      <td className="w-32 px-2 py-2">
                        <input type="number" min={0} step={100} value={h.startValue} onChange={(e) => patch(h.id, { startValue: num(e.target.value) })} onWheel={(e) => (e.target as HTMLInputElement).blur()} className={cellInput} />
                      </td>
                      <td className="w-28 px-2 py-2">
                        <input type="number" min={0} step={10} value={h.monthlyDeposit} onChange={(e) => patch(h.id, { monthlyDeposit: num(e.target.value) })} onWheel={(e) => (e.target as HTMLInputElement).blur()} className={cellInput} />
                      </td>
                      <td className="w-24 px-2 py-2">
                        <input type="number" min={0} step={0.1} value={h.yieldPct} onChange={(e) => patch(h.id, { yieldPct: num(e.target.value) })} onWheel={(e) => (e.target as HTMLInputElement).blur()} className={cellInput} />
                      </td>
                      <td className="w-24 px-2 py-2">
                        <input type="number" step={0.5} value={h.dividendGrowthPct} onChange={(e) => patch(h.id, { dividendGrowthPct: num(e.target.value) })} onWheel={(e) => (e.target as HTMLInputElement).blur()} className={cellInput} />
                      </td>
                      <td className="w-24 px-2 py-2">
                        <input type="number" step={0.5} value={h.priceGrowthPct} onChange={(e) => patch(h.id, { priceGrowthPct: num(e.target.value) })} onWheel={(e) => (e.target as HTMLInputElement).blur()} className={cellInput} />
                      </td>
                      <td className="w-10 px-2 py-2 text-right">
                        <button onClick={() => setHoldings((hs) => hs.filter((x) => x.id !== h.id))} className="text-muted-2 transition-colors hover:text-red" aria-label={`Remove ${h.ticker}`}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={custom.ticker}
                onChange={(e) => setCustom((c) => ({ ...c, ticker: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
                placeholder="Ticker, e.g. SCHD"
                className="w-36 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none placeholder:text-muted-2 focus:border-muted-2"
              />
              <input
                type="number"
                min={0}
                step={0.1}
                value={custom.yieldPct}
                onChange={(e) => setCustom((c) => ({ ...c, yieldPct: e.target.value }))}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                className="num w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm outline-none focus:border-muted-2"
              />
              <span className="text-xs text-muted-2">% yield</span>
              <button onClick={addCustom} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground">
                + Add asset to scenario
              </button>
            </div>
          </section>

          {/* Per-holding outcome */}
          <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <h2 className="mb-4 text-sm font-semibold tracking-wide">Where you end up · per holding</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    {["Holding", "End value", "Weight", "Income / mo", "Dividends collected"].map((h, i) => (
                      <th key={h} className={`px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-2 ${i === 0 ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.perHolding.map((h) => (
                    <tr key={h.id} className="border-b border-border-soft transition-colors hover:bg-card-hover">
                      <td className="px-3 py-2 font-medium">{h.ticker}</td>
                      <td className="num px-3 py-2 text-right">{formatMoney(h.endValue, CUR, 0)}</td>
                      <td className="num px-3 py-2 text-right text-muted">{(h.weightEnd * 100).toFixed(1)}%</td>
                      <td className="num px-3 py-2 text-right font-medium text-primary">{formatMoney(h.endMonthlyIncome, CUR, 0)}</td>
                      <td className="num px-3 py-2 text-right text-accent">{formatMoney(h.totalDividends, CUR, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="mt-10 pb-4 text-center text-[11px] text-muted-2">
            Scenario is saved in your browser · &quot;Reset to my portfolio&quot; reloads live holdings and yields · estimates, not financial advice
          </footer>
        </>
      )}
    </main>
  );
}
