"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import type { ForecastPoint } from "@/lib/forecast";
import { DEFAULT_SETTINGS, runForecast, type ForecastSettings } from "@/lib/forecast";
import { DEFAULT_GERMAN_TAX } from "@/lib/tax";
import { formatMoney, formatPct, monthLabel } from "@/lib/analytics";
import GermanTaxControls from "./GermanTaxControls";

const STORAGE_KEY = "dividend-tracker-forecast-settings";
const TARGET_COLORS = ["var(--amber)", "var(--violet)", "var(--blue)", "var(--red)", "var(--accent)"];

function loadSettings(): ForecastSettings {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ForecastSettings> & { targetMonthlyIncome?: number };
      // Migrate old single-target settings
      if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) {
        parsed.targets = parsed.targetMonthlyIncome ? [parsed.targetMonthlyIncome] : DEFAULT_SETTINGS.targets;
      }
      return { ...DEFAULT_SETTINGS, ...parsed, targets: parsed.targets, tax: { ...DEFAULT_GERMAN_TAX, ...parsed.tax } };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

function Field({
  label,
  value,
  onChange,
  step = 50,
  min = 0,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-2">{label}</span>
      <div className="mt-1 flex items-center rounded-xl border border-border bg-surface px-3 py-2 focus-within:border-muted-2">
        <input
          type="number"
          className="num w-full bg-transparent text-sm outline-none"
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(Number(e.target.value))}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
        />
        {suffix && <span className="ml-1 text-xs text-muted-2">{suffix}</span>}
      </div>
    </label>
  );
}

export default function ForecastPanel({
  portfolioValue,
  ttmDividends,
  currency,
}: {
  portfolioValue: number;
  ttmDividends: number;
  currency: string;
}) {
  const startYield = portfolioValue > 0 ? ttmDividends / portfolioValue : 0;
  // Rendered client-side only (after data fetch), so localStorage is available in the initializer
  const [settings, setSettings] = useState<ForecastSettings>(loadSettings);
  const [newTarget, setNewTarget] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const result = useMemo(() => runForecast(portfolioValue, startYield, settings), [portfolioValue, startYield, settings]);

  const set = (patch: Partial<ForecastSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const sortedTargets = [...new Set(settings.targets.filter((t) => t > 0))].sort((a, b) => a - b);

  const addTarget = () => {
    const v = Number(newTarget);
    if (v > 0 && !settings.targets.includes(v)) set({ targets: [...settings.targets, v] });
    setNewTarget("");
  };
  const removeTarget = (t: number) => set({ targets: settings.targets.filter((x) => x !== t) });

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-4">
        <Field label="Monthly deposit" value={settings.monthlyDeposit} onChange={(v) => set({ monthlyDeposit: v })} suffix={currency} />
        <Field label="Dividend growth / yr" value={settings.dividendGrowthPct} onChange={(v) => set({ dividendGrowthPct: v })} step={0.5} suffix="%" />
        <Field label="Capital growth / yr" value={settings.capitalGrowthPct} onChange={(v) => set({ capitalGrowthPct: v })} step={0.5} suffix="%" />
        <Field label="Inflation / yr" value={settings.inflationPct} onChange={(v) => set({ inflationPct: v })} step={0.5} suffix="%" />
        <label className="flex cursor-pointer items-center gap-2.5 pt-1">
          <input
            type="checkbox"
            checked={settings.reinvestDividends}
            onChange={(e) => set({ reinvestDividends: e.target.checked })}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span className="text-sm text-muted">Reinvest dividends</span>
        </label>

        <GermanTaxControls value={settings.tax} onChange={(tax) => set({ tax })} />

        <div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-2">Income targets / mo</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sortedTargets.map((t, i) => (
              <span
                key={t}
                className="num inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs"
                style={{ borderColor: TARGET_COLORS[i % TARGET_COLORS.length] }}
              >
                {formatMoney(t, currency, 0)}
                <button
                  onClick={() => removeTarget(t)}
                  className="text-muted-2 transition-colors hover:text-red"
                  aria-label={`Remove target ${t}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="number"
              min={0}
              step={100}
              placeholder="Add target…"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTarget()}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              className="num w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-muted-2"
            />
            <button
              onClick={addTarget}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-card-hover hover:text-foreground"
            >
              Add
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
          Starting from <span className="num text-foreground">{formatMoney(portfolioValue, currency, 0)}</span> at{" "}
          <span className="num text-foreground">{formatPct(startYield)}</span> trailing yield.
        </div>
      </div>

      <div>
        <div className="mb-4 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface">
              <tr>
                {["Target (today's money)", "Reached", "Time from now"].map((h, i) => (
                  <th key={h} className={`px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-2 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.milestones.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-center text-xs text-muted-2">Add at least one income target.</td>
                </tr>
              )}
              {result.milestones.map((ms, i) => (
                <tr key={ms.target} className="border-b border-border-soft last:border-0">
                  <td className="num px-4 py-2.5 font-medium">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: TARGET_COLORS[i % TARGET_COLORS.length] }} />
                    {formatMoney(ms.target, currency, 0)}/mo
                  </td>
                  <td className="num px-4 py-2.5 text-right">
                    {ms.date ? (
                      <>
                        <span className="font-semibold text-accent">{ms.date}</span>
                        {ms.nominalAtReach !== null && settings.inflationPct !== 0 && (
                          <div className="text-[11px] text-muted-2">≈ {formatMoney(ms.nominalAtReach, currency, 0)}/mo in {ms.date.split(" ")[1]} money</div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-2">not within 50 yrs</span>
                    )}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-muted">{ms.years !== null ? `${ms.years} yrs` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={result.points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="divGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border-soft)" />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--muted-2)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(d: string) => monthLabel(d)}
                minTickGap={40}
              />
              <YAxis
                tick={{ fill: "var(--muted-2)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v: number) => formatMoney(v, currency, 0)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(d) => monthLabel(String(d))}
                formatter={(v, name) => [formatMoney(Number(v), currency, 0), String(name)]}
              />
              {sortedTargets.map((t, i) => (
                <Line
                  key={t}
                  name={`${formatMoney(t, currency, 0)} target`}
                  type="monotone"
                  dataKey={(p: ForecastPoint) => t * p.inflationFactor}
                  stroke={TARGET_COLORS[i % TARGET_COLORS.length]}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                />
              ))}
              <Area name={settings.tax.enabled ? "Monthly dividends (net of tax)" : "Monthly dividends"} type="monotone" dataKey="monthlyDividend" stroke="var(--accent)" strokeWidth={2} fill="url(#divGrad)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-2">
          Projected monthly dividend income{settings.tax.enabled ? " after German tax" : ""} · dashed lines = your targets, rising with inflation
        </p>
      </div>
    </div>
  );
}
