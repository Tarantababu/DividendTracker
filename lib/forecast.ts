import { DEFAULT_GERMAN_TAX, taxOnIncome, type GermanTaxSettings } from "./tax";

export interface ForecastSettings {
  monthlyDeposit: number;
  dividendGrowthPct: number; // annual growth of the payout rate, e.g. 5 = 5%/yr
  capitalGrowthPct: number; // annual price appreciation of holdings
  inflationPct: number; // annual inflation; targets are in today's money and grow by this
  reinvestDividends: boolean;
  targets: number[]; // monthly income milestones in today's purchasing power, ascending
  tax: GermanTaxSettings;
}

export interface ForecastPoint {
  monthIndex: number;
  date: string; // "2027-03"
  portfolioValue: number;
  monthlyDividend: number; // net of German tax when enabled
  grossMonthlyDividend: number;
  annualDividend: number;
  inflationFactor: number; // multiplier turning today's money into that month's money
}

export interface Milestone {
  target: number; // in today's money
  monthIndex: number | null;
  date: string | null; // "March 2039"
  years: number | null;
  nominalAtReach: number | null; // inflated target at the reach date
}

export interface ForecastResult {
  points: ForecastPoint[];
  milestones: Milestone[];
}

export const DEFAULT_SETTINGS: ForecastSettings = {
  monthlyDeposit: 500,
  dividendGrowthPct: 5,
  capitalGrowthPct: 4,
  inflationPct: 2.5,
  reinvestDividends: true,
  targets: [500, 1000, 2000],
  tax: DEFAULT_GERMAN_TAX,
};

const MAX_YEARS = 50;

/**
 * Month-by-month simulation.
 * - `startYield` is the portfolio's trailing-twelve-month dividend yield (ttm / value).
 * - The payout rate grows by dividendGrowthPct annually (dividend raises),
 *   holdings appreciate by capitalGrowthPct annually,
 *   deposits (and optionally dividends) buy more at the current yield.
 * Each target in `settings.targets` is expressed in today's purchasing power;
 * it inflates by inflationPct annually, and its milestone is the month the
 * (nominal) dividend income first covers the inflated target.
 */
export function runForecast(
  startValue: number,
  startYield: number,
  s: ForecastSettings,
): ForecastResult {
  const targets = [...new Set(s.targets.filter((t) => t > 0))].sort((a, b) => a - b);
  const points: ForecastPoint[] = [];
  const reached = new Map<number, number>(); // target -> monthIndex
  const divGrowthM = Math.pow(1 + s.dividendGrowthPct / 100, 1 / 12);
  const capGrowthM = Math.pow(1 + s.capitalGrowthPct / 100, 1 / 12);
  const inflationM = Math.pow(1 + s.inflationPct / 100, 1 / 12);

  let value = startValue;
  let yieldRate = Math.max(startYield, 0.0001);
  let inflationFactor = 1;
  let lastReachedAt = 0;

  const now = new Date();
  let allowanceLeft = s.tax.annualAllowance;
  for (let m = 0; m <= MAX_YEARS * 12; m++) {
    if (m % 12 === 0) allowanceLeft = s.tax.annualAllowance; // allowance resets each year
    const grossMonthlyDividend = (value * yieldRate) / 12;
    const { tax, allowanceUsed } = taxOnIncome(grossMonthlyDividend, allowanceLeft, s.tax);
    allowanceLeft -= allowanceUsed;
    const monthlyDividend = grossMonthlyDividend - tax; // net income the investor can actually spend
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    let crossed = false;
    for (const t of targets) {
      if (!reached.has(t) && monthlyDividend >= t * inflationFactor) {
        reached.set(t, m);
        lastReachedAt = m;
        crossed = true;
      }
    }
    if (m % 3 === 0 || crossed) {
      points.push({ monthIndex: m, date: dateKey, portfolioValue: value, monthlyDividend, grossMonthlyDividend, annualDividend: value * yieldRate, inflationFactor });
    }
    // Keep the chart going a while past the last milestone, then stop
    if (targets.length > 0 && reached.size === targets.length && m >= Math.max(lastReachedAt + 24, 120)) break;

    value = value * capGrowthM + s.monthlyDeposit + (s.reinvestDividends ? monthlyDividend : 0);
    yieldRate *= divGrowthM;
    inflationFactor *= inflationM;
  }

  const milestones: Milestone[] = targets.map((t) => {
    const m = reached.get(t) ?? null;
    let date: string | null = null;
    if (m !== null) {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      date = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    }
    return {
      target: t,
      monthIndex: m,
      date,
      years: m !== null ? Math.round((m / 12) * 10) / 10 : null,
      nominalAtReach: m !== null ? t * Math.pow(1 + s.inflationPct / 100, m / 12) : null,
    };
  });

  return { points, milestones };
}
