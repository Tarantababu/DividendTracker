import { NextResponse } from "next/server";
import { bankConfigured, readLink, refreshLink, BankError, type BankSource } from "@/lib/bank";

export const dynamic = "force-dynamic";

export interface BankStatus {
  configured: boolean; // GoCardless credentials present (auto-sync available)
  linked: boolean; // a source is connected and has data
  pending: boolean; // GoCardless requisition created but consent not completed yet
  source: BankSource | null;
  accountIds: string[];
  linkedAt: string | null;
}

export async function GET() {
  try {
    let link = await readLink();

    // Manual CSV import needs no credentials — linked as soon as a file is imported.
    if (link?.source === "csv") {
      return NextResponse.json({
        configured: bankConfigured(),
        linked: link.accountIds.length > 0,
        pending: false,
        source: "csv",
        accountIds: link.accountIds,
        linkedAt: link.linkedAt,
      } satisfies BankStatus);
    }

    if (!bankConfigured()) {
      return NextResponse.json({ configured: false, linked: false, pending: false, source: null, accountIds: [], linkedAt: null } satisfies BankStatus);
    }

    // GoCardless: if a requisition exists but accounts aren't resolved, the user may
    // have just finished consent — try to pull the account ids now.
    if (link && link.accountIds.length === 0) {
      try {
        link = await refreshLink();
      } catch {
        /* keep the pending link */
      }
    }
    const linked = !!link && link.accountIds.length > 0;
    return NextResponse.json({
      configured: true,
      linked,
      pending: !!link && !linked,
      source: link?.source ?? null,
      accountIds: link?.accountIds ?? [],
      linkedAt: link?.linkedAt ?? null,
    } satisfies BankStatus);
  } catch (err) {
    if (err instanceof BankError) return NextResponse.json({ error: err.code, message: err.message }, { status: 502 });
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
