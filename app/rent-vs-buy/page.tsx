"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tooltipStyle } from "@/lib/chartTheme";
import { formatMoney } from "@/lib/analytics";
import { DEFAULT_RVB, runRentVsBuy, type RentVsBuySettings } from "@/lib/rentvsbuy";
import { DEFAULT_GERMAN_TAX } from "@/lib/tax";
import GermanTaxControls from "@/components/GermanTaxControls";

const STORAGE_KEY = "dividend-tracker-rvb-settings";
const CUR = "EUR";

function Field({
  label,
  value,
  onChange,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
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
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
        />
        {suffix && <span className="ml-1 shrink-0 text-xs text-muted-2">{suffix}</span>}
      </div>
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-2">{title}</h3>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

export default function RentVsBuyPage() {
  const [s, setS] = useState<RentVsBuySettings>(DEFAULT_RVB);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // One-time hydration from localStorage after mount; a lazy initializer would
    // mismatch the server-prerendered HTML
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setS({ ...DEFAULT_RVB, ...parsed, tax: { ...DEFAULT_GERMAN_TAX, ...parsed.tax } });
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }, [s, loaded]);

  const set = (patch: Partial<RentVsBuySettings>) => setS((prev) => ({ ...prev, ...patch }));
  const r = useMemo(() => runRentVsBuy(s), [s]);
  const buyWins = r.buyerFinal >= r.renterFinal;
  const gap = Math.abs(r.buyerFinal - r.renterFinal);
  // Month-1 cost comparison: whoever pays less for housing invests the difference
  const upkeepM1 = (s.homePrice * (s.propertyTaxPct + s.maintenancePct)) / 100 / 12;
  const ownerCostM1 = r.monthlyPayment + upkeepM1;
  const monthlyDiff = ownerCostM1 - s.monthlyRent;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rent vs Buy</h1>
          <p className="mt-0.5 text-xs text-muted-2">
            Buying compared against renting + investing the difference — the money a buyer sinks into the purchase works in the market for the renter
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Inputs */}
        <section className="space-y-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
          <Group title="The home">
            <Field label="Price" value={s.homePrice} onChange={(v) => set({ homePrice: v })} step={10000} suffix={CUR} />
            <Field label="Appreciation / yr" value={s.homeAppreciationPct} onChange={(v) => set({ homeAppreciationPct: v })} step={0.5} suffix="%" />
            <Field label="Property tax / yr" value={s.propertyTaxPct} onChange={(v) => set({ propertyTaxPct: v })} step={0.1} suffix="%" />
            <Field label="Maintenance / yr" value={s.maintenancePct} onChange={(v) => set({ maintenancePct: v })} step={0.1} suffix="%" />
          </Group>
          <Group title="Mortgage">
            <Field label="Down payment" value={s.downPaymentPct} onChange={(v) => set({ downPaymentPct: v })} step={5} suffix="%" />
            <Field label="Interest rate" value={s.mortgageRatePct} onChange={(v) => set({ mortgageRatePct: v })} step={0.1} suffix="%" />
            <Field label="Term" value={s.termYears} onChange={(v) => set({ termYears: v })} suffix="yrs" />
            <Field label="Buying costs" value={s.buyClosingPct} onChange={(v) => set({ buyClosingPct: v })} step={0.5} suffix="%" />
            <Field label="Selling costs" value={s.sellClosingPct} onChange={(v) => set({ sellClosingPct: v })} step={0.5} suffix="%" />
          </Group>
          <Group title="Renting instead">
            <Field label="Monthly rent" value={s.monthlyRent} onChange={(v) => set({ monthlyRent: v })} step={50} suffix={CUR} />
            <Field label="Rent growth / yr" value={s.rentGrowthPct} onChange={(v) => set({ rentGrowthPct: v })} step={0.5} suffix="%" />
            <Field label="Investment return" value={s.investmentReturnPct} onChange={(v) => set({ investmentReturnPct: v })} step={0.5} suffix="%" />
            <Field label="Horizon" value={s.horizonYears} onChange={(v) => set({ horizonYears: v })} suffix="yrs" />
          </Group>
          <div>
            <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-2">Taxes</h3>
            <GermanTaxControls value={s.tax} onChange={(tax) => set({ tax })} compact />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-2">
              Applied to investment gains (renter&apos;s portfolio and buyer&apos;s surplus investments). The owner-occupied home sale itself is tax-free in Germany.
            </p>
          </div>
        </section>

        {/* Results */}
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <p className="text-sm leading-relaxed text-muted">
              After <span className="num font-semibold text-foreground">{s.horizonYears} years</span>,{" "}
              <span className={`text-xl font-semibold ${buyWins ? "text-accent" : "text-blue"}`}>{buyWins ? "buying" : "renting + investing"}</span>{" "}
              leaves you ahead by <span className="num text-xl font-semibold text-foreground">{formatMoney(gap, CUR, 0)}</span>
              {r.breakEvenYearIndex !== null && !buyWins === false && (
                <span className="text-muted-2"> · buying overtakes renting around year {r.breakEvenYearIndex}</span>
              )}
              {r.breakEvenYearIndex === null && <span className="text-muted-2"> · buying never catches up within the horizon</span>}
            </p>
            <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-muted">
              <span className="font-medium text-foreground">First month:</span> owning costs{" "}
              <span className="num font-semibold text-foreground">{formatMoney(ownerCostM1, CUR, 0)}</span>
              <span className="num text-muted-2"> (mortgage {formatMoney(r.monthlyPayment, CUR, 0)}{upkeepM1 > 0 ? ` + tax & upkeep ${formatMoney(upkeepM1, CUR, 0)}` : ""})</span>{" "}
              vs rent <span className="num font-semibold text-foreground">{formatMoney(s.monthlyRent, CUR, 0)}</span> —{" "}
              {monthlyDiff > 0 ? (
                <>
                  the renter doesn&apos;t pay that extra, so they invest{" "}
                  <span className="num font-semibold text-blue">{formatMoney(monthlyDiff, CUR, 0)}/mo</span> at {s.investmentReturnPct}%/yr
                </>
              ) : (
                <>
                  owning is already cheaper, so the buyer invests{" "}
                  <span className="num font-semibold text-accent">{formatMoney(-monthlyDiff, CUR, 0)}/mo</span> at {s.investmentReturnPct}%/yr
                </>
              )}
              . The gap shifts every month as rent grows and upkeep follows the home&apos;s value.
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-2">Buyer net worth</div>
                <div className="num mt-1 text-lg font-semibold text-accent">{formatMoney(r.buyerFinal, CUR, 0)}</div>
              </div>
              <div className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-2">Renter net worth</div>
                <div className="num mt-1 text-lg font-semibold text-blue">{formatMoney(r.renterFinal, CUR, 0)}</div>
              </div>
              <div className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-2">Monthly payment</div>
                <div className="num mt-1 text-lg font-semibold">{formatMoney(r.monthlyPayment, CUR, 0)}</div>
              </div>
              <div className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-2">Cash to buy</div>
                <div className="num mt-1 text-lg font-semibold">{formatMoney(r.upfrontCash, CUR, 0)}</div>
                <div className="num text-[11px] text-muted-2">interest paid {formatMoney(r.totalInterest, CUR, 0)}</div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <h2 className="mb-4 text-sm font-semibold tracking-wide">Net worth over time</h2>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={r.points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="buyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                  <XAxis dataKey="year" tick={{ fill: "var(--muted-2)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis
                    tick={{ fill: "var(--muted-2)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                    tickFormatter={(v: number) => formatMoney(v, CUR, 0)}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, name) => [formatMoney(Number(v), CUR, 0), String(name)]}
                  />
                  <Area name="Buying (equity + surplus invested)" type="monotone" dataKey="buyerNetWorth" stroke="var(--accent)" strokeWidth={2} fill="url(#buyGrad)" />
                  <Line name="Renting + investing" type="monotone" dataKey="renterNetWorth" stroke="var(--blue)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-2">
              Buyer = home value net of selling costs − remaining loan + invested surplus · Renter = invested down payment, buying costs and monthly savings
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 text-xs leading-relaxed text-muted-2 shadow-sm">
            <strong className="text-muted">How it works:</strong> both paths start with the same cash ({formatMoney(r.upfrontCash, CUR, 0)} — down payment plus buying
            costs). The buyer pays mortgage, property tax and maintenance but no rent; the renter pays only rent. Each month, whoever pays less for housing invests
            the difference at {s.investmentReturnPct}%/yr — e.g. mortgage {formatMoney(ownerCostM1, CUR, 0)} vs rent {formatMoney(s.monthlyRent, CUR, 0)} means the
            renter invests {formatMoney(Math.max(monthlyDiff, 0), CUR, 0)}/mo (plus the {formatMoney(r.upfrontCash, CUR, 0)} they never sank into the purchase).
            Once owning becomes cheaper than renting (typically after the mortgage ends), the flow reverses and the buyer invests.
            {s.tax.enabled
              ? " German Abgeltungsteuer is deducted from both sides' investment gains (as if sold at each point); the owner-occupied home sale is tax-free."
              : ""}{" "}
            Estimates only — rent deposits, Vorabpauschale and imputed-rent effects are not modelled.
          </section>
        </div>
      </div>
    </main>
  );
}
