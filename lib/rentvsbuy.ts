import { DEFAULT_GERMAN_TAX, taxOnRealisedGains, type GermanTaxSettings } from "./tax";

export interface RentVsBuySettings {
  homePrice: number;
  downPaymentPct: number; // % of price paid upfront
  mortgageRatePct: number; // annual interest
  termYears: number;
  buyClosingPct: number; // one-off purchase costs (notary, tax, fees)
  sellClosingPct: number; // selling costs at horizon
  propertyTaxPct: number; // % of current home value per year
  maintenancePct: number; // % of current home value per year (incl. insurance)
  homeAppreciationPct: number; // annual
  monthlyRent: number;
  rentGrowthPct: number; // annual
  investmentReturnPct: number; // annual return the renter (and owner surplus) earns
  horizonYears: number;
  tax: GermanTaxSettings; // German Abgeltungsteuer on investment gains; owner-occupied home sale stays tax-free
}

export const DEFAULT_RVB: RentVsBuySettings = {
  homePrice: 300_000,
  downPaymentPct: 20,
  mortgageRatePct: 3.8,
  termYears: 30,
  buyClosingPct: 8,
  sellClosingPct: 3,
  propertyTaxPct: 0.5,
  maintenancePct: 1.2,
  homeAppreciationPct: 3,
  monthlyRent: 1200,
  rentGrowthPct: 3,
  investmentReturnPct: 7,
  horizonYears: 25,
  tax: DEFAULT_GERMAN_TAX,
};

export interface RvbPoint {
  monthIndex: number;
  year: number; // e.g. 2031
  buyerNetWorth: number; // home equity after selling costs + invested surplus
  renterNetWorth: number; // invested down payment + monthly differences
  homeValue: number;
  loanBalance: number;
  monthlyOwnerCost: number;
  monthlyRent: number;
}

export interface RvbResult {
  points: RvbPoint[];
  monthlyPayment: number;
  upfrontCash: number; // down payment + closing costs
  buyerFinal: number;
  renterFinal: number;
  breakEvenYearIndex: number | null; // years from now when buying overtakes renting (null = never within horizon)
  totalInterest: number;
}

/**
 * Monthly simulation. Both paths start with the same cash (down payment +
 * closing costs) and pay their housing cost each month; whoever pays less
 * invests the difference at investmentReturnPct. Buyer wealth = home equity
 * net of selling costs + invested surplus; renter wealth = portfolio.
 */
export function runRentVsBuy(s: RentVsBuySettings): RvbResult {
  const months = Math.max(1, Math.round(s.horizonYears * 12));
  const loan0 = s.homePrice * (1 - s.downPaymentPct / 100);
  const mRate = s.mortgageRatePct / 100 / 12;
  const nPay = s.termYears * 12;
  const monthlyPayment =
    mRate === 0 ? loan0 / nPay : (loan0 * mRate) / (1 - Math.pow(1 + mRate, -nPay));
  const upfrontCash = s.homePrice * (s.downPaymentPct / 100) + s.homePrice * (s.buyClosingPct / 100);

  const invM = Math.pow(1 + s.investmentReturnPct / 100, 1 / 12);
  const appM = Math.pow(1 + s.homeAppreciationPct / 100, 1 / 12);
  const rentM = Math.pow(1 + s.rentGrowthPct / 100, 1 / 12);

  let homeValue = s.homePrice;
  let loanBalance = loan0;
  let rent = s.monthlyRent;
  let renterPortfolio = upfrontCash; // renter invests the cash the buyer sank into the purchase
  let renterContrib = upfrontCash; // cost basis — contributions are not taxed, only gains
  let ownerPortfolio = 0;
  let ownerContrib = 0;
  let totalInterest = 0;
  let breakEven: number | null = null;

  const points: RvbPoint[] = [];
  const startYear = new Date().getFullYear();
  const startMonth = new Date().getMonth();

  for (let m = 1; m <= months; m++) {
    // Owner month
    const interest = loanBalance > 0 ? loanBalance * mRate : 0;
    let payment = 0;
    if (loanBalance > 0) {
      payment = Math.min(monthlyPayment, loanBalance + interest);
      const principal = payment - interest;
      loanBalance = Math.max(0, loanBalance - principal);
      totalInterest += interest;
    }
    const upkeep = (homeValue * (s.propertyTaxPct + s.maintenancePct)) / 100 / 12;
    const ownerCost = payment + upkeep;

    // Grow assets, pay housing, invest the difference
    renterPortfolio *= invM;
    ownerPortfolio *= invM;
    const diff = ownerCost - rent;
    if (diff > 0) {
      renterPortfolio += diff;
      renterContrib += diff;
    } else {
      ownerPortfolio += -diff;
      ownerContrib += -diff;
    }

    homeValue *= appM;
    rent *= rentM;

    // As-if-sold-today: German capital-gains tax on portfolio gains; the
    // owner-occupied home sale itself is tax-free in Germany
    const renterTax = taxOnRealisedGains(renterPortfolio - renterContrib, s.tax);
    const ownerTax = taxOnRealisedGains(ownerPortfolio - ownerContrib, s.tax);
    const renterNetWorth = renterPortfolio - renterTax;
    const buyerNetWorth = homeValue * (1 - s.sellClosingPct / 100) - loanBalance + ownerPortfolio - ownerTax;
    if (breakEven === null && buyerNetWorth >= renterNetWorth) breakEven = m;

    if (m % 12 === 0 || m === months) {
      points.push({
        monthIndex: m,
        year: startYear + Math.floor((startMonth + m) / 12),
        buyerNetWorth,
        renterNetWorth,
        homeValue,
        loanBalance,
        monthlyOwnerCost: ownerCost,
        monthlyRent: rent,
      });
    }
  }

  const last = points[points.length - 1];
  return {
    points,
    monthlyPayment,
    upfrontCash,
    buyerFinal: last.buyerNetWorth,
    renterFinal: last.renterNetWorth,
    breakEvenYearIndex: breakEven !== null ? Math.ceil(breakEven / 12) : null,
    totalInterest,
  };
}
