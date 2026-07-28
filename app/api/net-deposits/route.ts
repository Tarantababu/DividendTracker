import { NextRequest, NextResponse } from "next/server";
import { loadNetDepositOverrides, NET_DEPOSITS_STORE } from "@/lib/t212";
import { readDiskCache, writeDiskCache, deleteDiskCache } from "@/lib/diskCache";

export const dynamic = "force-dynamic";

/**
 * Per-pie net deposits (money in − out). Trading212's API never exposes this per
 * pie, so it has to be maintained by hand — which previously meant editing a file
 * AND a Vercel env var, then redeploying, every time money went in. This route
 * lets the app save them instead: stored through the disk cache, so on Vercel they
 * are mirrored to Blob and survive cold starts.
 */
export async function GET() {
  const values = await loadNetDepositOverrides();
  const saved = await readDiskCache<Record<string, number>>(NET_DEPOSITS_STORE, Number.MAX_SAFE_INTEGER);
  return NextResponse.json({ values, savedAt: saved ? new Date(Date.now() - saved.ageMs).toISOString() : null });
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON", message: "Expected a JSON body." }, { status: 400 });
  }
  const input = (body as { values?: Record<string, unknown> })?.values;
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "BAD_REQUEST", message: "Expected { values: { \"Pie name\": number } }." }, { status: 400 });
  }

  // Only keep finite, non-negative numbers — a stray NaN here would silently
  // corrupt every P/L figure that divides by it.
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    const n = typeof v === "string" ? Number(v.replace(",", ".")) : (v as number);
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) clean[k.trim()] = Math.round(n * 100) / 100;
  }
  if (Object.keys(clean).length === 0) {
    return NextResponse.json({ error: "BAD_REQUEST", message: "No valid values supplied." }, { status: 400 });
  }

  // Merge over what's saved so editing one pie doesn't drop the others.
  const existing = (await readDiskCache<Record<string, number>>(NET_DEPOSITS_STORE, Number.MAX_SAFE_INTEGER))?.value ?? {};
  const merged = { ...existing, ...clean };
  await writeDiskCache(NET_DEPOSITS_STORE, merged);

  // Net deposits are an INPUT to the pies and overview snapshots, so those are now
  // wrong. Without dropping them the old figures keep being served for the whole
  // stale-serve window and the edit looks like it did nothing.
  // deleteDiskCache clears the in-memory registry entry too, so the next request
  // rebuilds from the new overrides on this instance and on any other.
  await Promise.all([deleteDiskCache("pies-snapshot.json"), deleteDiskCache("overview-snapshot.json")]);

  return NextResponse.json({ ok: true, values: await loadNetDepositOverrides() });
}
