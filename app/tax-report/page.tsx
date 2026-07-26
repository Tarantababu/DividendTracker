"use client";

import { useEffect, useMemo, useState } from "react";
import GermanTaxControls from "@/components/GermanTaxControls";
import { formatMoney } from "@/lib/analytics";
import { DEFAULT_GERMAN_TAX, type GermanTaxSettings } from "@/lib/tax";
import { availableTaxYears, buildTaxReport, reportToCsv } from "@/lib/taxreport";
import type { DividendItem, DividendsPayload } from "@/lib/types";

const TAX_KEY = "dividend-tracker-taxreport-settings";
const CUR = "EUR";

export default function TaxReportPage() {
  const [items, setItems] = useState<DividendItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [tax, setTax] = useState<GermanTaxSettings>(DEFAULT_GERMAN_TAX);
  const [taxLoaded, setTaxLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TAX_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setTax({ ...DEFAULT_GERMAN_TAX, ...JSON.parse(raw) });
    } catch {}
    setTaxLoaded(true);
    (async () => {
      try {
        const res = await fetch("/api/dividends");
        if (!res.ok) throw new Error((await res.json()).message ?? "Could not load dividend history");
        const data = (await res.json()) as DividendsPayload;
        setItems(data.items);
        const years = availableTaxYears(data.items);
        // Default to the last complete tax year when it has data, else the latest year
        const prev = new Date().getFullYear() - 1;
        setYear(years.includes(prev) ? prev : (years[0] ?? null));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (taxLoaded) localStorage.setItem(TAX_KEY, JSON.stringify(tax));
  }, [tax, taxLoaded]);

  const years = useMemo(() => (items ? availableTaxYears(items) : []), [items]);
  const report = useMemo(() => (items && year !== null ? buildTaxReport(items, year, tax) : null), [items, year, tax]);

  const downloadCsv = () => {
    if (!report) return;
    const blob = new Blob([reportToCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dividenden-steuerreport-${report.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const e = report?.estimate;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">German tax report</h1>
          <p className="mt-0.5 text-xs text-muted-2">Dividend income per tax year — a working aid for your Steuererklärung (Anlage KAP)</p>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-[color-mix(in_srgb,var(--red)_30%,transparent)] bg-[color-mix(in_srgb,var(--red)_6%,transparent)] px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}
      {!items && !error && (
        <div className="flex min-h-64 items-center justify-center">
          <div className="animate-pulse text-sm text-muted">Loading dividend history…</div>
        </div>
      )}

      {report && (
        <>
          {/* Controls */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm">
              {years.map((y) => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    y === year ? "bg-[var(--primary)] text-[var(--primary-fg)]" : "text-muted hover:bg-card-hover hover:text-foreground"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={downloadCsv} className="rounded-md border border-border bg-card px-4 py-2 text-xs font-medium text-muted transition-colors hover:bg-card-hover hover:text-foreground">
                Download CSV
              </button>
              <button onClick={() => window.print()} className="rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90">
                Print / PDF
              </button>
            </div>
          </div>

          {/* Print header */}
          <div className="hidden print:block">
            <h1 className="text-lg font-semibold">Dividenden-Steuerreport {report.year}</h1>
            <p className="text-xs text-muted">Erstellt am {new Date().toLocaleDateString("de-DE")} · Trading212-Konto · alle Beträge in EUR</p>
          </div>

          {/* Overview */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm print:shadow-none">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Dividends received {report.year}</div>
              <div className="num mt-1.5 text-2xl font-semibold text-primary">{formatMoney(report.totalEur, CUR)}</div>
            </div>
            <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm print:shadow-none">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Payments</div>
              <div className="num mt-1.5 text-2xl font-semibold">{report.paymentCount}</div>
              <div className="num mt-1 text-xs text-muted">from {report.payerCount} securities</div>
            </div>
            <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm print:shadow-none">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Estimated tax due</div>
              <div className="num mt-1.5 text-2xl font-semibold text-red">{e && tax.enabled ? formatMoney(e.estimatedTax, CUR) : "—"}</div>
              {tax.enabled && <div className="num mt-1 text-xs text-muted">at {e?.taxRatePct.toFixed(3)}% on the taxable base</div>}
            </div>
            <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm print:shadow-none">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Net after tax</div>
              <div className="num mt-1.5 text-2xl font-semibold text-accent">{e && tax.enabled ? formatMoney(e.netAfterTax, CUR) : formatMoney(report.totalEur, CUR)}</div>
            </div>
          </div>

          {/* Tax computation */}
          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5 print:shadow-none">
              <h2 className="mb-1 text-sm font-semibold tracking-wide">Abgeltungsteuer computation</h2>
              <p className="mb-4 text-xs text-muted-2">Assumes no tax was withheld at source on these amounts — verify against your broker statement</p>
              <div className="mb-4 print:hidden">
                <GermanTaxControls value={tax} onChange={setTax} compact />
              </div>
              {tax.enabled && e ? (
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["Kapitalerträge (dividends received)", formatMoney(e.grossIncome, CUR)],
                      [`− Teilfreistellung (${tax.partialExemptionPct}% fund exemption)`, "−" + formatMoney(e.partialExemption, CUR)],
                      ["= Assessable income", formatMoney(e.assessable, CUR)],
                      [`− Sparerpauschbetrag (allowance used)`, "−" + formatMoney(e.allowanceUsed, CUR)],
                      ["= Taxable base", formatMoney(e.taxableBase, CUR)],
                      [`× Tax rate (25% + Soli${tax.churchTaxPct ? ` + ${tax.churchTaxPct}% church` : ""})`, e.taxRatePct.toFixed(3) + "%"],
                    ].map(([label, val], i) => (
                      <tr key={i} className="border-b border-border-soft">
                        <td className="py-2 text-muted">{label}</td>
                        <td className="num py-2 text-right">{val}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 font-semibold">Estimated Abgeltungsteuer</td>
                      <td className="num py-2 text-right font-semibold text-red">{formatMoney(e.estimatedTax, CUR)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-2">Enable German tax to see the estimate.</p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5 print:shadow-none">
              <h2 className="mb-4 text-sm font-semibold tracking-wide">By month</h2>
              <table className="w-full text-sm">
                <tbody>
                  {report.byMonth.map((m) => (
                    <tr key={m.month} className="border-b border-border-soft">
                      <td className="py-1.5 text-muted">{m.label}</td>
                      <td className="num py-1.5 text-right">{m.total > 0 ? formatMoney(m.total, CUR) : <span className="text-muted-2">—</span>}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 font-semibold">Summe</td>
                    <td className="num py-2 text-right font-semibold">{formatMoney(report.totalEur, CUR)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Per holding */}
          <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5 print:shadow-none">
            <h2 className="mb-4 text-sm font-semibold tracking-wide">By security · {report.year}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    {["Security", "ISIN", "Payments", "Total EUR"].map((h, i) => (
                      <th key={h} className={`px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-2 ${i < 2 ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.byHolding.map((h) => (
                    <tr key={h.isin + h.ticker} className="border-b border-border-soft">
                      <td className="px-3 py-2">
                        <span className="font-medium">{h.ticker}</span> <span className="text-xs text-muted-2">{h.name}</span>
                      </td>
                      <td className="num px-3 py-2 text-xs text-muted">{h.isin}</td>
                      <td className="num px-3 py-2 text-right text-muted">{h.payments}</td>
                      <td className="num px-3 py-2 text-right font-medium">{formatMoney(h.totalEur, CUR)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* All transactions */}
          <section className="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5 print:shadow-none">
            <h2 className="mb-4 text-sm font-semibold tracking-wide">All dividend transactions · {report.year}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    {["Date", "Security", "ISIN", "Shares", "Gross / share", "Amount EUR", "Type"].map((h, i) => (
                      <th key={h} className={`px-2.5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-2 ${i < 3 ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.transactions.map((t, i) => (
                    <tr key={i} className="border-b border-border-soft">
                      <td className="num px-2.5 py-1.5 text-muted">{new Date(t.paidOn).toLocaleDateString("de-DE")}</td>
                      <td className="px-2.5 py-1.5">
                        <span className="font-medium">{t.ticker}</span> <span className="text-xs text-muted-2">{t.name}</span>
                      </td>
                      <td className="num px-2.5 py-1.5 text-xs text-muted">{t.isin}</td>
                      <td className="num px-2.5 py-1.5 text-right text-muted">{t.quantity.toLocaleString("de-DE", { maximumFractionDigits: 4 })}</td>
                      <td className="num px-2.5 py-1.5 text-right text-muted">
                        {t.grossPerShare !== null ? `${t.grossPerShare.toLocaleString("de-DE", { maximumFractionDigits: 4 })} ${t.instrumentCurrency}` : "—"}
                      </td>
                      <td className="num px-2.5 py-1.5 text-right font-medium">{formatMoney(t.amountEur, CUR)}</td>
                      <td className="px-2.5 py-1.5 text-right text-xs text-muted-2">{t.type}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-2.5 py-2.5 font-semibold">Summe {report.year}</td>
                    <td className="num px-2.5 py-2.5 text-right font-semibold text-primary">{formatMoney(report.totalEur, CUR)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <footer className="mt-8 rounded-xl border border-border bg-card p-5 text-xs leading-relaxed text-muted-2 shadow-sm print:shadow-none">
            <strong className="text-muted">Notes for your declaration:</strong> amounts are the EUR sums credited by Trading212 (foreign withholding tax, e.g. 15% US,
            may already have been deducted at source — check your Trading212 annual statement for the gross figures and creditable Quellensteuer, Anlage KAP lines 40/41).
            Realised gains and losses from sales are not included here. Fund distributions qualify for Teilfreistellung only if the fund holds ≥51% equities.
            This report is a working aid generated from your account data, not tax advice and not an official document.
          </footer>
        </>
      )}
    </main>
  );
}
