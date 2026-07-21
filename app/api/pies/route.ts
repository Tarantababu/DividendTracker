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
const TTL_MS = 5 * 60 * 1000;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.payload);
  try {
    const pies = await getPies();
    const payload: PiesPayload = { pies, fetchedAt: new Date().toISOString() };
    cached = { payload, at: Date.now() };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
