import { NextResponse } from "next/server";
import { clearLink } from "@/lib/bank";

export const dynamic = "force-dynamic";

// Forget the local N26 link + cached transactions. (Does not revoke the GoCardless
// consent itself — the user can do that from their GoCardless dashboard / N26 app.)
export async function POST() {
  await clearLink();
  return NextResponse.json({ ok: true });
}
