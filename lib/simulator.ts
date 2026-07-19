export interface SimHolding {
  id: string; // ticker or custom id
  ticker: string; // display symbol
  name: string;
  startValue: number;
  monthlyDeposit: number;
  yieldPct: number; // annual dividend yield on value, %
  dividendGrowthPct: number; // annual growth of the payout rate, %
  priceGrowthPct: number; // annual price appreciation, %
}

import { DEFAULT_GERMAN_TAX, taxOnIncome, type GermanTaxSettings } from "./tax";

export interface SimSettings {
  horizonYears: number;
  reinvestDividends: boolean;
  tax: GermanTaxSettings;
}

export const DEFAULT_SIM_SETTINGS: SimSettings = {
  horizonYears: 15,
  reinvestDividends: true,
  tax: DEFAULT_GERMAN_TAX,
};

export interface SimPoint {
  monthIndex: number;
  date: string; // "2031-03"
  portfolioValue: number;
  monthlyIncome: number; // net of German tax when enabled
  grossMonthlyIncome: number;
  deposited: number; // cumulative deposits (excl. starting values)
}

export interface SimHoldingResult {
  id: string;
  ticker: string;
  name: string;
  endValue: number;
  endMonthlyIncome: number;
  totalDividends: number;
  weightEnd: number;
}

export interface SimResult {
  points: SimPoint[];
  perHolding: SimHoldingResult[];
  startValue: number;
  startMonthlyIncome: number;
  endValue: number;
  endMonthlyIncome: number; // net when tax enabled
  totalDeposited: number;
  totalDividends: number; // net when tax enabled
  totalTaxPaid: number;
}

/**
 * Month-by-month per-holding simulation. Each holding keeps its own value,
 * payout rate and deposit stream; dividends are (optionally) reinvested into
 * the holding that paid them. All figures nominal.
 */
export function runSimulation(holdings: SimHolding[], s: SimSettings): SimResult {
  const months = Math.max(1, Math.round(s.horizonYears * 12));
  const state = holdings.map((h) => ({
    h,
    value: Math.max(0, h.startValue),
    yieldRate: Math.max(0, h.yieldPct) / 100,
    priceM: Math.pow(1 + h.priceGrowthPct / 100, 1 / 12),
    divGrowthM: Math.pow(1 + h.dividendGrowthPct / 100, 1 / 12),
    totalDividends: 0,
  }));

  const startValue = state.reduce((sum, x) => sum + x.value, 0);
  const startMonthlyIncome = state.reduce((sum, x) => sum + (x.value * x.yieldRate) / 12, 0);

  const points: SimPoint[] = [];
  const now = new Date();
  let deposited = 0;
  let totalTaxPaid = 0;
  let allowanceLeft = s.tax.annualAllowance;

  for (let m = 1; m <= months; m++) {
    if ((m - 1) % 12 === 0) allowanceLeft = s.tax.annualAllowance; // allowance resets each year
    // Gross dividends this month, per holding
    const divs = state.map((x) => (x.value * x.yieldRate) / 12);
    const grossMonthlyIncome = divs.reduce((a, b) => a + b, 0);
    // The annual allowance is shared across the portfolio: tax the total, spread the drag pro-rata
    const { tax, allowanceUsed } = taxOnIncome(grossMonthlyIncome, allowanceLeft, s.tax);
    allowanceLeft -= allowanceUsed;
    totalTaxPaid += tax;
    const netFactor = grossMonthlyIncome > 0 ? (grossMonthlyIncome - tax) / grossMonthlyIncome : 1;

    state.forEach((x, i) => {
      const netDiv = divs[i] * netFactor;
      x.totalDividends += netDiv;
      x.value = x.value * x.priceM + x.h.monthlyDeposit + (s.reinvestDividends ? netDiv : 0);
      x.yieldRate *= x.divGrowthM;
      deposited += x.h.monthlyDeposit;
    });

    if (m % 3 === 0 || m === months || m === 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      points.push({
        monthIndex: m,
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        portfolioValue: state.reduce((sum, x) => sum + x.value, 0),
        monthlyIncome: grossMonthlyIncome - tax,
        grossMonthlyIncome,
        deposited,
      });
    }
  }

  const endValue = state.reduce((sum, x) => sum + x.value, 0);
  // Net factor on the final year's income (fresh allowance, whole year)
  const endGrossAnnual = state.reduce((sum, x) => sum + x.value * x.yieldRate, 0);
  const endTax = taxOnIncome(endGrossAnnual, s.tax.annualAllowance, s.tax).tax;
  const endNetFactor = endGrossAnnual > 0 ? (endGrossAnnual - endTax) / endGrossAnnual : 1;

  const perHolding: SimHoldingResult[] = state
    .map((x) => ({
      id: x.h.id,
      ticker: x.h.ticker,
      name: x.h.name,
      endValue: x.value,
      endMonthlyIncome: ((x.value * x.yieldRate) / 12) * endNetFactor,
      totalDividends: x.totalDividends,
      weightEnd: endValue > 0 ? x.value / endValue : 0,
    }))
    .sort((a, b) => b.endValue - a.endValue);

  return {
    points,
    perHolding,
    startValue,
    startMonthlyIncome,
    endValue,
    endMonthlyIncome: perHolding.reduce((sum, x) => sum + x.endMonthlyIncome, 0),
    totalDeposited: deposited,
    totalDividends: state.reduce((sum, x) => sum + x.totalDividends, 0),
    totalTaxPaid,
  };
}
