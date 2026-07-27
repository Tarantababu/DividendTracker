import { NextResponse, NextRequest, after } from "next/server";
import { getPies, T212Error, type PieSummary } from "@/lib/t212";
import { readDiskCache, refreshOnce } from "@/lib/diskCache";

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
function loadPies(detailMaxAgeMs?: number): Promise<PiesPayload> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const pies = await getPies({ detailMaxAgeMs });
      const payload: PiesPayload = { pies, fetchedAt: new Date().toISOString() };
      cached = { payload, at: Date.now() };
      return payload;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

const DISK_FILE = "pies-snapshot.json";
const STALE_SERVE_MS = 24 * 60 * 60 * 1000; // a day-old snapshot still beats a 25s wait

export async function GET(req: NextRequest) {
  // ?refresh=1 — the user explicitly asked for fresh numbers, so skip every cache
  // and pay the rebuild.
  const refresh = req.nextUrl.searchParams.get("refresh");
  const force = refresh === "1" || refresh === "full";
  const full = refresh === "full";
  if (!force && cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.payload);

  // Cold instance: fall back to the on-disk snapshot. Rebuilding costs ~25s
  // (5 pie-detail calls at 1 req/5s), so serve what we have and refresh behind
  // the response rather than making the dashboard wait for it.
  const disk = force ? null : await readDiskCache<PiesPayload>(DISK_FILE, TTL_MS);
  if (disk && disk.ageMs < STALE_SERVE_MS) {
    cached = { payload: disk.value, at: Date.now() - disk.ageMs };
    if (!disk.fresh) after(() => refreshOnce(DISK_FILE, loadPies).catch(() => undefined));
    return NextResponse.json(disk.fresh ? disk.value : { ...disk.value, stale: true });
  }

  try {
    // ?refresh=1 pulls fresh money figures in a single list call, reusing the
    // cached instrument mix — that's the fast path the user actually wants.
    // ?refresh=full also re-reads every pie's name and holdings (one rate-limited
    // call per pie, ~25s), for when a pie has been renamed or edited in T212.
    const payload = await refreshOnce(DISK_FILE, () => loadPies(full ? 0 : undefined));
    return NextResponse.json(payload);
  } catch (err) {
    // A transient rate-limit shouldn't blank the UI: serve the last good snapshot
    // if we have one, even past its TTL. Only error out on a genuine cold failure.
    if (cached) return NextResponse.json({ ...cached.payload, stale: true });
    if (disk) return NextResponse.json({ ...disk.value, stale: true });
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
