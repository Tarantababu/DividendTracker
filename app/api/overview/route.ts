import { NextResponse } from "next/server";
import { getAccountSummary, getPositions, getPies, T212Error } from "@/lib/t212";
import type { OverviewPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Account summary is limited to 1 req/5s and positions to 1 req/s;
// a short in-memory cache absorbs client re-fetches within one dev session.
let cached: { payload: OverviewPayload; at: number } | null = null;
const TTL_MS = 20_000;

export async function GET() {
  try {
    if (cached && Date.now() - cached.at < TTL_MS) {
      return NextResponse.json(cached.payload);
    }
    // Pies are fetched alongside positions so the dashboard has exact category
    // values on its first render. A pies failure must not fail the whole overview
    // (the client falls back to /api/pies), so it's settled independently.
    const [summary, positions, piesResult] = await Promise.all([
      getAccountSummary(),
      getPositions(),
      getPies().catch(() => null),
    ]);
    const payload: OverviewPayload = {
      summary,
      positions,
      pies: piesResult ?? [],
      fetchedAt: new Date().toISOString(),
    };
    cached = { payload, at: Date.now() };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
