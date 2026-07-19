import { NextRequest, NextResponse } from "next/server";
import { syncBank, BankError, type AccountBalance } from "@/lib/bank";
import { normalize, summarize, type BudgetSummary, type Txn } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export interface BankTransactionsPayload {
  txns: Txn[]; // default categorization; the client refines with its overrides
  summary: BudgetSummary; // server-side default summary (recomputed client-side after overrides)
  balances: AccountBalance[];
  syncedAt: string;
}

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    // syncBank serves a CSV import without credentials; only the GoCardless network
    // path needs them, and it surfaces NOT_LINKED / NOT_CONFIGURED itself.
    const data = await syncBank(force);
    const txns = normalize(data.transactions);
    const summary = summarize(txns);
    return NextResponse.json({ txns, summary, balances: data.balances, syncedAt: data.syncedAt } satisfies BankTransactionsPayload);
  } catch (err) {
    if (err instanceof BankError) {
      const status = err.code === "NOT_LINKED" ? 409 : err.code === "RATE_LIMITED" ? 429 : err.code === "NOT_CONFIGURED" ? 428 : 502;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
