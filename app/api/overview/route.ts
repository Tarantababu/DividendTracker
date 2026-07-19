import { NextResponse } from "next/server";
import { getAccountSummary, getPositions, T212Error } from "@/lib/t212";
import type { OverviewPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

// Account summary is limited to 1 req/5s and positions to 1 req/s;
// a short in-memory cache absorbs client re-fetches within one dev session.
let cached: { payload: OverviewPayload; at: number } | null = null;
const TTL_MS = 20_000;

export async function GET() {
  try {
    if (cached && Date.now() - cached.at < TTL_MS) {
      return NextResponse.json(cached.payload);
    }
    const summary = await getAccountSummary();
    const positions = await getPositions();
    const payload: OverviewPayload = { summary, positions, fetchedAt: new Date().toISOString() };
    cached = { payload, at: Date.now() };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
