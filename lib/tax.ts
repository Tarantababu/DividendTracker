/**
 * German investment taxation (Abgeltungsteuer).
 *
 * - Flat 25% on investment income + 5.5% solidarity surcharge on that tax,
 *   optionally + 8/9% church tax on the tax → 26.375% (28.20%/28.43% with church).
 * - Sparerpauschbetrag: annual tax-free allowance (€1,000 single / €2,000 joint).
 * - Teilfreistellung: for equity funds (≥51% equities) 30% of distributions and
 *   gains are tax-exempt. Individual stocks get no exemption.
 * Vorabpauschale (advance lump-sum tax on accumulating funds) is not modelled.
 */
export interface GermanTaxSettings {
  enabled: boolean;
  churchTaxPct: number; // 0, 8 or 9 — % of the tax, not of income
  annualAllowance: number; // Sparerpauschbetrag
  partialExemptionPct: number; // Teilfreistellung on the taxed income, 0-100
}

export const DEFAULT_GERMAN_TAX: GermanTaxSettings = {
  enabled: true,
  churchTaxPct: 0,
  annualAllowance: 1000,
  partialExemptionPct: 30,
};

/** Combined rate applied to the taxable part: 25% × (1 + 5.5% soli + church%). */
export function combinedTaxRate(s: GermanTaxSettings): number {
  return 0.25 * (1 + 0.055 + s.churchTaxPct / 100);
}

/**
 * Tax due on `grossIncome` given `allowanceLeft` of the annual allowance still
 * unused. Returns the tax and how much allowance was consumed.
 */
export function taxOnIncome(
  grossIncome: number,
  allowanceLeft: number,
  s: GermanTaxSettings,
): { tax: number; allowanceUsed: number } {
  if (!s.enabled || grossIncome <= 0) return { tax: 0, allowanceUsed: 0 };
  const assessable = grossIncome * (1 - s.partialExemptionPct / 100);
  const allowanceUsed = Math.min(assessable, Math.max(0, allowanceLeft));
  const taxable = assessable - allowanceUsed;
  return { tax: taxable * combinedTaxRate(s), allowanceUsed };
}

/** Tax on realised gains at a one-off sale (one year's allowance applied). */
/**
 * The GROSS investment income needed to be left with `net` after German tax.
 *
 * FIRE targets are built from the expenses you must actually pay, but the income
 * funding them is taxable — so a target sized on gross income leaves you short.
 * Inverts taxOnIncome exactly (it's piecewise linear):
 *   net = gross − max(0, gross·(1−exemption) − allowance)·rate
 */
export function grossUpIncome(net: number, s: GermanTaxSettings): number {
  if (!s.enabled || net <= 0) return Math.max(0, net);
  // Below the allowance nothing is due, so gross == net.
  const assessableAtNet = net * (1 - s.partialExemptionPct / 100);
  if (assessableAtNet <= s.annualAllowance) return net;
  const rate = combinedTaxRate(s);
  const k = 1 - (1 - s.partialExemptionPct / 100) * rate;
  if (k <= 0) return net; // degenerate settings — don't divide by ~0
  return (net - s.annualAllowance * rate) / k;
}

export function taxOnRealisedGains(gains: number, s: GermanTaxSettings): number {
  return taxOnIncome(gains, s.annualAllowance, s).tax;
}
