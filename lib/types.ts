import type { PieSummary } from "./t212";

export interface AccountSummary {
  currency: string;
  cash: {
    availableToTrade: number;
    inPies: number;
    reservedForOrders: number;
  };
  investments: {
    totalCost: number;
    currentValue: number;
    unrealizedProfitLoss: number;
    realizedProfitLoss: number;
  };
  totalValue: number;
}

export interface Position {
  averagePricePaid: number;
  createdAt: string;
  currentPrice: number;
  instrument: {
    currency: string;
    isin: string;
    name: string;
    ticker: string;
  };
  quantity: number;
  quantityAvailableForTrading: number;
  quantityInPies: number;
  walletImpact: {
    currency: string;
    currentValue: number;
    fxImpact: number;
    totalCost: number;
    unrealizedProfitLoss: number;
  };
}

export interface DividendItem {
  ticker: string;
  reference?: string;
  quantity: number;
  amount: number; // in account currency
  grossAmountPerShare?: number; // in the instrument's currency
  amountInEuro?: number;
  paidOn: string; // ISO date
  type?: string;
  currency?: string;
  instrument?: {
    ticker: string;
    name: string;
    isin: string;
    currency: string;
  };
}

export interface DividendsPayload {
  items: DividendItem[];
  lastSync: string | null;
  syncedPages?: number;
}

export interface OverviewPayload {
  summary: AccountSummary;
  positions: Position[];
  // Real Trading212 pies, fetched alongside positions so category values are
  // exact from the first render (no post-mount fetch window that would briefly
  // show the reconstructed split). Empty if the pies call failed; the client
  // then falls back to fetching /api/pies on its own.
  pies?: PieSummary[];
  fetchedAt: string;
}
