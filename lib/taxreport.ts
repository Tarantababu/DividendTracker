import type { DividendItem } from "./types";
import { combinedTaxRate, type GermanTaxSettings } from "./tax";
import { prettyTicker } from "./analytics";

export interface TaxTransaction {
  paidOn: string;
  ticker: string;
  name: string;
  isin: string;
  quantity: number;
  grossPerShare: number | null;
  instrumentCurrency: string;
  amountEur: number; // received in account currency (net of foreign withholding)
  type: string;
}

export interface HoldingTaxSummary {
  ticker: string;
  name: string;
  isin: string;
  payments: number;
  totalEur: number;
}

export interface TaxEstimate {
  grossIncome: number;
  partialExemption: number; // amount exempted via Teilfreistellung
  assessable: number; // after exemption
  allowanceUsed: number; // Sparerpauschbetrag applied
  taxableBase: number;
  taxRatePct: number;
  estimatedTax: number;
  netAfterTax: number;
}

export interface TaxReport {
  year: number;
  transactions: TaxTransaction[];
  byHolding: HoldingTaxSummary[];
  byMonth: { month: number; label: string; total: number }[];
  totalEur: number;
  paymentCount: number;
  payerCount: number;
  estimate: TaxEstimate;
}

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function availableTaxYears(items: DividendItem[]): number[] {
  const years = new Set<number>();
  for (const d of items) years.add(new Date(d.paidOn).getFullYear());
  return [...years].sort((a, b) => b - a);
}

export function buildTaxReport(items: DividendItem[], year: number, tax: GermanTaxSettings): TaxReport {
  const inYear = items
    .filter((d) => new Date(d.paidOn).getFullYear() === year)
    .sort((a, b) => Date.parse(a.paidOn) - Date.parse(b.paidOn));

  const transactions: TaxTransaction[] = inYear.map((d) => ({
    paidOn: d.paidOn,
    ticker: prettyTicker(d.ticker),
    name: d.instrument?.name ?? prettyTicker(d.ticker),
    isin: d.instrument?.isin ?? "—",
    quantity: d.quantity,
    grossPerShare: d.grossAmountPerShare ?? null,
    instrumentCurrency: d.instrument?.currency ?? d.currency ?? "",
    amountEur: d.amountInEuro ?? d.amount,
    type: d.type ?? "DIVIDEND",
  }));

  const holdingMap = new Map<string, HoldingTaxSummary>();
  for (const t of transactions) {
    const cur = holdingMap.get(t.isin + t.ticker) ?? { ticker: t.ticker, name: t.name, isin: t.isin, payments: 0, totalEur: 0 };
    cur.payments++;
    cur.totalEur += t.amountEur;
    holdingMap.set(t.isin + t.ticker, cur);
  }
  const byHolding = [...holdingMap.values()].sort((a, b) => b.totalEur - a.totalEur);

  const byMonth = MONTHS_DE.map((label, month) => ({
    month,
    label,
    total: transactions.filter((t) => new Date(t.paidOn).getMonth() === month).reduce((s, t) => s + t.amountEur, 0),
  }));

  const totalEur = transactions.reduce((s, t) => s + t.amountEur, 0);

  // Abgeltungsteuer estimate on this year's dividend income
  const partialExemption = tax.enabled ? totalEur * (tax.partialExemptionPct / 100) : 0;
  const assessable = totalEur - partialExemption;
  const allowanceUsed = tax.enabled ? Math.min(assessable, tax.annualAllowance) : 0;
  const taxableBase = Math.max(0, assessable - allowanceUsed);
  const rate = tax.enabled ? combinedTaxRate(tax) : 0;
  const estimatedTax = taxableBase * rate;

  return {
    year,
    transactions,
    byHolding,
    byMonth,
    totalEur,
    paymentCount: transactions.length,
    payerCount: byHolding.length,
    estimate: {
      grossIncome: totalEur,
      partialExemption,
      assessable,
      allowanceUsed,
      taxableBase,
      taxRatePct: rate * 100,
      estimatedTax,
      netAfterTax: totalEur - estimatedTax,
    },
  };
}

/** Semicolon-separated CSV with German decimal commas (opens cleanly in German Excel). */
export function reportToCsv(report: TaxReport): string {
  const numDE = (v: number, digits = 2) => v.toFixed(digits).replace(".", ",");
  const lines = [
    `Dividenden-Steuerreport ${report.year}`,
    `Erstellt;${new Date().toLocaleDateString("de-DE")}`,
    "",
    "Datum;Wertpapier;Ticker;ISIN;Stück;Brutto je Stück;Währung;Betrag EUR;Typ",
    ...report.transactions.map((t) =>
      [
        new Date(t.paidOn).toLocaleDateString("de-DE"),
        `"${t.name}"`,
        t.ticker,
        t.isin,
        numDE(t.quantity, 4),
        t.grossPerShare !== null ? numDE(t.grossPerShare, 4) : "",
        t.instrumentCurrency,
        numDE(t.amountEur),
        t.type,
      ].join(";"),
    ),
    "",
    `Summe erhaltene Dividenden;;;;;;;${numDE(report.totalEur)};EUR`,
    `Anzahl Zahlungen;${report.paymentCount}`,
    `Anzahl Wertpapiere;${report.payerCount}`,
  ];
  return "﻿" + lines.join("\r\n");
}
