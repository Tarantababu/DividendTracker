// Budget analytics: normalize N26 (GoCardless) transactions, categorize them by
// keyword rules, and roll them up into monthly income/spend + savings rate.
import type { RawTx } from "./bank";

export interface Txn {
  id: string;
  date: string; // YYYY-MM-DD (booking date)
  amount: number; // + income, - spend, account currency
  currency: string;
  counterparty: string; // creditor or debtor name
  reference: string; // remittance info
  category: string; // resolved category key
  pending: boolean;
}

export type CategoryKind = "income" | "expense" | "transfer";

export interface CategoryDef {
  key: string;
  label: string;
  kind: CategoryKind;
  keywords: string[]; // matched against counterparty + reference, case-insensitive
}

// Order matters: first match wins. "transfer" excludes internal moves & savings
// from the spend/income totals so the savings rate isn't double-counted.
export const CATEGORY_RULES: CategoryDef[] = [
  { key: "salary", label: "Salary & income", kind: "income", keywords: ["salary", "gehalt", "lohn", "payroll", "wages", "employer"] },
  { key: "transfer", label: "Transfers & savings", kind: "transfer", keywords: ["trading 212", "trading212", "n26 spaces", "savings", "sparen", "own account", "überweisung eigen", "flatex", "scalable", "revolut", "wise", "paypal transfer"] },
  { key: "rent", label: "Rent & housing", kind: "expense", keywords: ["rent", "miete", "vermiet", "wohnung", "hausverwaltung", "landlord"] },
  { key: "utilities", label: "Utilities & bills", kind: "expense", keywords: ["strom", "electric", "gas", "wasser", "energie", "vodafone", "telekom", "o2", "internet", "insurance", "versicherung", "gez", "rundfunk"] },
  { key: "groceries", label: "Groceries", kind: "expense", keywords: ["rewe", "edeka", "aldi", "lidl", "kaufland", "penny", "netto", "dm ", "rossmann", "supermarket", "grocery", "denns", "biocompany"] },
  { key: "dining", label: "Dining & takeaway", kind: "expense", keywords: ["restaurant", "cafe", "coffee", "starbucks", "mcdonald", "burger", "lieferando", "uber eats", "wolt", "bar ", "pizza", "kebab", "bakery", "bäcker"] },
  { key: "transport", label: "Transport", kind: "expense", keywords: ["bvg", "db ", "deutsche bahn", "uber", "bolt", "freenow", "tankstelle", "shell", "aral", "esso", "fuel", "petrol", "flixbus", "bvg", "hvv", "mvg", "parking"] },
  { key: "shopping", label: "Shopping", kind: "expense", keywords: ["amazon", "zalando", "ikea", "mediamarkt", "saturn", "apple", "zara", "h&m", "decathlon", "otto", "aboutyou"] },
  { key: "subscriptions", label: "Subscriptions", kind: "expense", keywords: ["netflix", "spotify", "youtube", "disney", "amazon prime", "icloud", "google", "audible", "gym", "fitness", "mcfit", "urban sports"] },
  { key: "health", label: "Health", kind: "expense", keywords: ["apotheke", "pharmacy", "arzt", "doctor", "zahnarzt", "dentist", "klinik", "hospital"] },
  { key: "cash", label: "Cash & ATM", kind: "expense", keywords: ["atm", "geldautomat", "cash", "bargeld", "withdrawal"] },
];

const DEFAULT_INCOME = "other-income";
const DEFAULT_EXPENSE = "other-expense";

export function categoryLabel(key: string): string {
  if (key === DEFAULT_INCOME) return "Other income";
  if (key === DEFAULT_EXPENSE) return "Other spending";
  return CATEGORY_RULES.find((c) => c.key === key)?.label ?? key;
}

export function categoryKind(key: string): CategoryKind {
  if (key === DEFAULT_INCOME) return "income";
  if (key === DEFAULT_EXPENSE) return "expense";
  return CATEGORY_RULES.find((c) => c.key === key)?.kind ?? "expense";
}

function classify(text: string, amount: number, overrides: Record<string, string>): string {
  const hay = text.toLowerCase();
  for (const [needle, cat] of Object.entries(overrides)) {
    if (needle && hay.includes(needle.toLowerCase())) return cat;
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => hay.includes(k))) return rule.key;
  }
  return amount >= 0 ? DEFAULT_INCOME : DEFAULT_EXPENSE;
}

/** Normalize + categorize raw GoCardless transactions. `overrides` maps a text substring → category key. */
export function normalize(raw: RawTx[], overrides: Record<string, string> = {}): Txn[] {
  return raw
    .map((t) => {
      const amount = Number(t.transactionAmount.amount);
      const counterparty = t.creditorName || t.debtorName || "";
      const reference = t.remittanceInformationUnstructured || (t.remittanceInformationUnstructuredArray ?? []).join(" ") || "";
      const date = (t.bookingDate || t.valueDate || "").slice(0, 10);
      const category = classify(`${counterparty} ${reference}`, amount, overrides);
      return {
        id: t.transactionId ?? t.internalTransactionId ?? `${date}|${amount}|${reference}`.slice(0, 80),
        date,
        amount,
        currency: t.transactionAmount.currency,
        counterparty,
        reference,
        category,
        pending: !!t.pending,
      };
    })
    .filter((t) => t.date)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Re-apply user category overrides keyed by lowercased counterparty. Pure — runs client-side. */
export function applyOverrides(txns: Txn[], counterpartyOverrides: Record<string, string>): Txn[] {
  if (Object.keys(counterpartyOverrides).length === 0) return txns;
  return txns.map((t) => {
    const ov = counterpartyOverrides[t.counterparty.toLowerCase().trim()];
    return ov && ov !== t.category ? { ...t, category: ov } : t;
  });
}

export interface CategorySummary {
  key: string;
  label: string;
  kind: CategoryKind;
  total: number; // absolute magnitude
  count: number;
}

export interface MonthSummary {
  month: string; // "2026-07"
  income: number; // positive
  expenses: number; // positive magnitude
  net: number; // income - expenses
  savingsRate: number; // net / income
}

export interface BudgetSummary {
  currency: string;
  months: MonthSummary[]; // chronological
  // Trailing-period rollup (last full N months, excluding the current partial one)
  avgIncome: number;
  avgExpenses: number;
  avgNet: number;
  savingsRate: number;
  categories: CategorySummary[]; // expenses only, largest first, over the trailing window
  txnCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Aggregate normalized transactions into monthly income/spend and a trailing
 * average. Transfers are excluded from both income and expenses (they're moves
 * between your own pots, not earning or spending). `windowMonths` sets how many
 * completed months feed the averages that drive the FIRE handoff.
 */
export function summarize(txns: Txn[], windowMonths = 3): BudgetSummary {
  const currency = txns[0]?.currency ?? "EUR";
  const byMonth = new Map<string, { income: number; expenses: number }>();
  for (const t of txns) {
    if (t.pending) continue;
    if (categoryKind(t.category) === "transfer") continue;
    const m = monthOf(t.date);
    const e = byMonth.get(m) ?? { income: 0, expenses: 0 };
    if (t.amount >= 0) e.income += t.amount;
    else e.expenses += -t.amount;
    byMonth.set(m, e);
  }

  const months: MonthSummary[] = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, income: v.income, expenses: v.expenses, net: v.income - v.expenses, savingsRate: v.income > 0 ? (v.income - v.expenses) / v.income : 0 }));

  // Trailing window of completed months (drop the current, still-partial month)
  const nowMonth = monthOf(new Date().toISOString().slice(0, 10));
  const completed = months.filter((m) => m.month !== nowMonth);
  const window = completed.slice(-windowMonths);
  const n = window.length || 1;
  const avgIncome = window.reduce((a, m) => a + m.income, 0) / n;
  const avgExpenses = window.reduce((a, m) => a + m.expenses, 0) / n;
  const avgNet = avgIncome - avgExpenses;

  // Category breakdown (expenses) over the same trailing window
  const windowMonthsSet = new Set(window.map((m) => m.month));
  const catMap = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    if (t.pending) continue;
    if (t.amount >= 0) continue;
    if (categoryKind(t.category) === "transfer") continue;
    if (window.length > 0 && !windowMonthsSet.has(monthOf(t.date))) continue;
    const e = catMap.get(t.category) ?? { total: 0, count: 0 };
    e.total += -t.amount;
    e.count += 1;
    catMap.set(t.category, e);
  }
  const categories: CategorySummary[] = [...catMap.entries()]
    .map(([key, v]) => ({ key, label: categoryLabel(key), kind: categoryKind(key), total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);

  const dates = txns.map((t) => t.date).filter(Boolean).sort();

  return {
    currency,
    months,
    avgIncome,
    avgExpenses,
    avgNet,
    savingsRate: avgIncome > 0 ? avgNet / avgIncome : 0,
    categories,
    txnCount: txns.filter((t) => !t.pending).length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
