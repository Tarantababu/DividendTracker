import { NextResponse, NextRequest, after } from "next/server";
import { getAccountSummary, getPositions, getPies, T212Error } from "@/lib/t212";
import { readDiskCache, refreshOnce } from "@/lib/diskCache";
import type { OverviewPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Account summary is limited to 1 req/5s and positions to 1 req/s;
// a short in-memory cache absorbs client re-fetches within one dev session.
let cached: { payload: OverviewPayload; at: number } | null = null;
const TTL_MS = 20_000;

const DISK_FILE = "overview-snapshot.json";
const STALE_SERVE_MS = 24 * 60 * 60 * 1000;

async function build(): Promise<OverviewPayload> {
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
  return payload;
}

export async function GET(req: NextRequest) {
  // ?refresh=1 — user-initiated; bypass every cache and pull live numbers.
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  let disk: Awaited<ReturnType<typeof readDiskCache<OverviewPayload>>> = null;
  try {
    if (!force && cached && Date.now() - cached.at < TTL_MS) {
      return NextResponse.json(cached.payload);
    }

    // Cold instance: a rebuild costs ~30s against T212's rate limits. Serve the
    // last snapshot straight away — and when it's past its TTL, refresh after the
    // response so the next caller gets fresh data without anyone having waited.
    disk = force ? null : await readDiskCache<OverviewPayload>(DISK_FILE, TTL_MS);
    if (disk && disk.ageMs < STALE_SERVE_MS) {
      cached = { payload: disk.value, at: Date.now() - disk.ageMs };
      if (!disk.fresh) after(() => refreshOnce(DISK_FILE, build).catch(() => undefined));
      return NextResponse.json(disk.fresh ? disk.value : { ...disk.value, stale: true });
    }

    return NextResponse.json(await refreshOnce(DISK_FILE, build));
  } catch (err) {
    if (disk) return NextResponse.json({ ...disk.value, stale: true });
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
