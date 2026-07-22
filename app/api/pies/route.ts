import { NextResponse } from "next/server";
import { getPies, T212Error, type PieSummary } from "@/lib/t212";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export interface PiesPayload {
  pies: PieSummary[];
  fetchedAt: string;
}

// Pies change slowly; a short in-memory cache absorbs client re-fetches and keeps
// us well under the pies-endpoint rate limit (list + one detail call per pie).
let cached: { payload: PiesPayload; at: number } | null = null;
let inFlight: Promise<PiesPayload> | null = null;
const TTL_MS = 5 * 60 * 1000;

// Coalesce concurrent callers: the four dashboard components each fetch /api/pies
// on mount, so without this a cold cache would fan out into 4× the T212 calls and
// trip the pies-endpoint rate limit (→ 502). One in-flight fetch is shared by all.
function loadPies(): Promise<PiesPayload> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const pies = await getPies();
      const payload: PiesPayload = { pies, fetchedAt: new Date().toISOString() };
      cached = { payload, at: Date.now() };
      return payload;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.payload);
  try {
    return NextResponse.json(await loadPies());
  } catch (err) {
    // A transient rate-limit shouldn't blank the UI: serve the last good snapshot
    // if we have one, even past its TTL. Only error out on a genuine cold failure.
    if (cached) return NextResponse.json({ ...cached.payload, stale: true });
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
