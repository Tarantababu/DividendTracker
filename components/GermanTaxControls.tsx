"use client";

import { combinedTaxRate, type GermanTaxSettings } from "@/lib/tax";

export default function GermanTaxControls({
  value,
  onChange,
  compact = false,
}: {
  value: GermanTaxSettings;
  onChange: (v: GermanTaxSettings) => void;
  compact?: boolean;
}) {
  const set = (patch: Partial<GermanTaxSettings>) => onChange({ ...value, ...patch });
  const effectivePct = (combinedTaxRate(value) * (1 - value.partialExemptionPct / 100) * 100).toFixed(2);

  const smallInput = "num w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-right text-sm outline-none focus:border-muted-2";

  return (
    <div className={compact ? "" : "rounded-xl border border-border bg-surface/60 p-3"}>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          className="h-4 w-4 accent-[var(--primary)]"
        />
        <span className="text-sm text-muted">
          German tax <span className="text-muted-2">(Abgeltungsteuer{value.enabled ? ` · effectively ${effectivePct}% above the allowance` : ""})</span>
        </span>
      </label>
      {value.enabled && (
        <div className="mt-2.5 grid grid-cols-3 gap-2.5">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-2">Church tax</span>
            <select
              value={value.churchTaxPct}
              onChange={(e) => set({ churchTaxPct: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-muted-2"
            >
              <option value={0}>none</option>
              <option value={8}>8%</option>
              <option value={9}>9%</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-2">Allowance / yr</span>
            <input
              type="number"
              min={0}
              step={100}
              value={value.annualAllowance}
              onChange={(e) => set({ annualAllowance: Number(e.target.value) })}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              className={`mt-1 ${smallInput}`}
              title="Sparerpauschbetrag: €1,000 single, €2,000 married"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-2">Fund exemption</span>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={value.partialExemptionPct}
              onChange={(e) => set({ partialExemptionPct: Math.max(0, Math.min(100, Number(e.target.value))) })}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              className={`mt-1 ${smallInput}`}
              title="Teilfreistellung: 30% for equity funds (≥51% equities), 0% for individual stocks"
            />
          </label>
        </div>
      )}
    </div>
  );
}
