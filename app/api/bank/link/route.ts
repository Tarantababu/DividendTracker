import { NextResponse } from "next/server";
import { bankConfigured, createRequisition, BankError } from "@/lib/bank";

export const dynamic = "force-dynamic";

// Start the N26 consent flow: returns a hosted link the user opens to log in to
// N26 and grant access. On completion GoCardless redirects back to /budget.
export async function POST() {
  if (!bankConfigured()) {
    return NextResponse.json({ error: "NOT_CONFIGURED", message: "Add GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY to .env.local first." }, { status: 428 });
  }
  try {
    const { link, requisitionId } = await createRequisition();
    return NextResponse.json({ link, requisitionId });
  } catch (err) {
    if (err instanceof BankError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "AUTH_FAILED" ? 401 : 502 });
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
