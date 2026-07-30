import type { CashTransaction } from "./t212";
import { DEFAULT_GERMAN_TAX, grossUpIncome, taxOnIncome, type GermanTaxSettings } from "./tax";

/** External money movements — everything else (interest, dividends) is internal return. */
const CASHFLOW_TYPES = new Set(["DEPOSIT", "WITHDRAW", "WITHDRAWAL", "TRANSFER"]);

export interface Cashflow {
  date: string; // ISO
  amount: number; // + into the account, - out
}

export function externalCashflows(transactions: CashTransaction[]): Cashflow[] {
  return transactions
    .filter((t) => CASHFLOW_TYPES.has(t.type))
    .map((t) => ({ date: t.dateTime, amount: t.amount }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Money-weighted annual return (XIRR). Investor perspective: contributions are
 * negative flows, the current portfolio value is the final positive flow.
 * Newton's method with bisection fallback; null when there is no sign change
 * or the series is too short to be meaningful.
 */
export function xirr(flows: Cashflow[], currentValue: number, asOf = new Date()): number | null {
  if (flows.length === 0 || currentValue <= 0) return null;
  const t0 = Date.parse(flows[0].date);
  const YEAR = 365.25 * 86400_000;
  const points = [
    ...flows.map((f) => ({ years: (Date.parse(f.date) - t0) / YEAR, amount: -f.amount })),
    { years: (asOf.getTime() - t0) / YEAR, amount: currentValue },
  ];
  if (points[points.length - 1].years < 0.25) return null; // < 3 months of history: rate is noise
  const hasNeg = points.some((p) => p.amount < 0);
  const hasPos = points.some((p) => p.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const npv = (rate: number) => points.reduce((sum, p) => sum + p.amount / Math.pow(1 + rate, p.years), 0);

  // Newton
  let rate = 0.1;
  for (let i = 0; i < 60; i++) {
    const f = npv(rate);
    const h = 1e-6;
    const df = (npv(rate + h) - f) / h;
    if (!isFinite(df) || df === 0) break;
    const next = rate - f / df;
    if (!isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - rate) < 1e-8) return next;
    rate = next;
  }

  // Bisection fallback on [-0.95, 10]
  let lo = -0.95;
  let hi = 10;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

export interface ContributionStats {
  netContributions: number; // lifetime deposits + transfers - withdrawals
  trailing12mNet: number;
  monthlyAvg12m: number;
  firstFlowDate: string | null;
}

export function contributionStats(flows: Cashflow[], asOf = new Date()): ContributionStats {
  const netContributions = flows.reduce((sum, f) => sum + f.amount, 0);
  const cutoff = asOf.getTime() - 365.25 * 86400_000;
  const trailing12mNet = flows.filter((f) => Date.parse(f.date) >= cutoff).reduce((sum, f) => sum + f.amount, 0);
  return {
    netContributions,
    trailing12mNet,
    monthlyAvg12m: trailing12mNet / 12,
    firstFlowDate: flows.length > 0 ? flows[0].date.slice(0, 10) : null,
  };
}

// ---- FIRE types -----------------------------------------------------------

export type FireType = "lean" | "regular" | "fat" | "coast" | "barista" | "dividend";

export interface FireTypeConfig {
  key: FireType;
  label: string;
  blurb: string;
}

export const FIRE_TYPES: FireTypeConfig[] = [
  { key: "lean", label: "Lean FIRE", blurb: "Bare-bones expenses covered — frugal independence." },
  { key: "regular", label: "Regular FIRE", blurb: "Full expenses at your safe withdrawal rate (the 25× rule)." },
  { key: "fat", label: "Fat FIRE", blurb: "Comfortable, no compromises — expenses scaled up." },
  { key: "coast", label: "Coast FIRE", blurb: "Enough invested now that compounding alone reaches Regular FIRE — you can stop adding money." },
  { key: "barista", label: "Barista FIRE", blurb: "Part-time income covers part of expenses; the portfolio covers the rest." },
  { key: "dividend", label: "Dividend FIRE", blurb: "Live on dividends alone — income covers expenses, never sell a share." },
];

export interface FireTargetInputs {
  monthlyExpenses: number;
  withdrawalRatePct: number; // SWR, e.g. 4
  annualReturnPct: number; // used to discount the Coast target
  portfolioYieldPct: number; // actual trailing dividend yield, for Dividend FIRE
  leanPct: number; // Lean expenses as % of base, e.g. 60
  fatMultiple: number; // Fat expenses multiple, e.g. 2
  baristaMonthlyIncome: number; // side income covering part of expenses
  coastYears: number; // years until you'd start drawing down
  inflationPct?: number; // discounts the Coast target in real terms
  /** German tax on the income that funds retirement. Expenses are what you must
   *  actually pay, so the target is sized on the GROSS income needed to net them. */
  tax?: GermanTaxSettings;
}

/** The portfolio value each FIRE type requires. */
export function fireTarget(type: FireType, inp: FireTargetInputs): number {
  const swr = Math.max(0.1, inp.withdrawalRatePct) / 100;
  // Live on `monthlyExpenses` NET, so the portfolio has to throw off more than that
  // before tax. Without this every target is undersized by the tax on its own income.
  const grossUp = (net: number) => (inp.tax ? grossUpIncome(net, inp.tax) : net);
  const annualExpenses = grossUp(inp.monthlyExpenses * 12);
  const regular = annualExpenses / swr;
  switch (type) {
    case "lean":
      return grossUp((inp.monthlyExpenses * 12 * Math.max(0, inp.leanPct)) / 100) / swr;
    case "fat":
      return grossUp(inp.monthlyExpenses * 12 * Math.max(1, inp.fatMultiple)) / swr;
    case "barista":
      // Only the shortfall the portfolio must cover is grossed up; the side income
      // is earned income and outside this model.
      return grossUp(Math.max(0, (inp.monthlyExpenses - inp.baristaMonthlyIncome) * 12)) / swr;
    case "dividend": {
      const y = Math.max(0.1, inp.portfolioYieldPct) / 100;
      return annualExpenses / y; // value whose dividends equal annual expenses
    }
    case "coast": {
      // Discount at the REAL return: `regular` is in today's money, so compounding
      // it back with a nominal rate would understate what you actually need now.
      const real = (1 + inp.annualReturnPct / 100) / (1 + Math.max(0, inp.inflationPct ?? 0) / 100) - 1;
      return regular / Math.pow(1 + real, Math.max(0, inp.coastYears));
    }
    default:
      return regular;
  }
}

export interface FireInputs {
  currentValue: number;
  monthlyContribution: number;
  annualReturnPct: number; // nominal TOTAL return (price growth + dividends)
  target: number; // required portfolio value (from fireTarget), in today's money
  incomeRatePct: number; // rate producing spendable income — SWR, or yield for Dividend FIRE
  /** Annual inflation. The projection then runs in today's money: the target stays
   *  comparable to today's expenses and the ETA is a real-terms answer. */
  inflationPct?: number;
  /** Portfolio dividend yield, the income slice of the total return. */
  dividendYieldPct?: number;
  /** Reinvest dividends (after tax) instead of taking them as cash. */
  reinvestDividends?: boolean;
  /** German tax treatment of distributions. Uses the app's real model —
   *  Teilfreistellung (30% of equity-fund income is exempt) and the annual
   *  Sparerpauschbetrag — rather than a flat headline rate, which overstates the
   *  drag on reinvestment by roughly a third. */
  dividendTax?: GermanTaxSettings;
}

export interface FirePoint {
  date: string; // "2031-03"
  value: number;
  contributed: number; // cumulative future contributions
  monthlyIncome: number; // value * incomeRate / 12
}

export interface FireProjection {
  target: number;
  progressPct: number; // currentValue / target
  monthsToTarget: number | null; // null = not within 60y
  targetDate: string | null;
  points: FirePoint[]; // quarterly, until target (+ a bit past) or 30y
}

export function projectFire(inp: FireInputs): FireProjection {
  const target = inp.target;
  const incomeRate = Math.max(0, inp.incomeRatePct) / 100;
  const maxMonths = 60 * 12;

  // Everything below runs in TODAY'S money. Deflating the nominal return by
  // inflation means the target (built from today's expenses) stays the right
  // yardstick for decades out, instead of flattering the ETA.
  const inflation = Math.max(0, inp.inflationPct ?? 0) / 100;
  const totalReturn = inp.annualReturnPct / 100;
  const dividendYield = Math.max(0, inp.dividendYieldPct ?? 0) / 100;
  const reinvest = inp.reinvestDividends !== false; // default: reinvest
  const tax = inp.dividendTax ?? DEFAULT_GERMAN_TAX;

  // The yield is the income slice OF the total return, so price growth is what's
  // left. Splitting them is what lets reinvestment (and its tax drag) matter.
  const priceReturn = Math.max(-0.99, totalReturn - dividendYield);
  const realPriceGrowthM = Math.pow((1 + priceReturn) / (1 + inflation), 1 / 12);
  const realDivRateM = dividendYield / 12 / (1 + inflation);

  let value = inp.currentValue;
  let allowanceLeft = tax.annualAllowance;
  let contributed = 0;
  let monthsToTarget: number | null = value >= target ? 0 : null;
  const points: FirePoint[] = [];
  const now = new Date();
  let stopAt: number | null = monthsToTarget === 0 ? 12 : null;

  for (let m = 1; m <= maxMonths; m++) {
    // Reset the tax-free allowance each calendar year of the projection.
    if ((m - 1) % 12 === 0) allowanceLeft = tax.annualAllowance;
    const dividends = value * realDivRateM;
    value = value * realPriceGrowthM + inp.monthlyContribution;
    // Reinvested dividends compound net of tax; taken as cash they don't compound
    // at all, which is exactly the drag this models.
    if (reinvest && dividends > 0) {
      const { tax: due, allowanceUsed } = taxOnIncome(dividends, allowanceLeft, tax);
      allowanceLeft -= allowanceUsed;
      value += dividends - due;
    }
    contributed += inp.monthlyContribution;
    if (monthsToTarget === null && value >= target) {
      monthsToTarget = m;
      stopAt = Math.min(maxMonths, Math.ceil((m * 1.15) / 12) * 12); // chart breathes a little past the goal
    }
    const chartCap = stopAt ?? 30 * 12;
    if (m <= chartCap && (m % 3 === 0 || m === 1)) {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      points.push({
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        value,
        contributed,
        monthlyIncome: (value * incomeRate) / 12,
      });
    }
    if (stopAt !== null && m >= stopAt) break;
  }

  let targetDate: string | null = null;
  if (monthsToTarget !== null && monthsToTarget > 0) {
    const d = new Date(now.getFullYear(), now.getMonth() + monthsToTarget, 1);
    targetDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  return {
    target,
    progressPct: target > 0 ? inp.currentValue / target : 1,
    monthsToTarget,
    targetDate,
    points,
  };
}
