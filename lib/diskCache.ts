import fs from "fs/promises";
import path from "path";
import { CACHE_DIR } from "./cacheDir";

/**
 * Small JSON cache used to survive what in-memory caches can't: a cold serverless
 * instance. Trading212's per-endpoint limits (1 req / 5s on several routes) mean
 * rebuilding from scratch costs tens of seconds, so serving a slightly stale
 * snapshot instantly and refreshing behind the response is far better than making
 * the page wait.
 *
 * Two tiers, because the local and deployed filesystems behave very differently:
 *  - Local: .cache/ is permanent, so the file IS the cache.
 *  - Vercel: only /tmp is writable, and it's per-instance and wiped on recycle —
 *    a cold instance would rebuild everything (measured ~160s). So on Vercel we
 *    also mirror snapshots to Vercel Blob, which every instance can read.
 * /tmp is still used in front of Blob as a fast local mirror.
 */
const USE_BLOB = !!process.env.VERCEL && !!process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_PREFIX = "cache/";

interface Entry<T> {
  at: number;
  value: T;
}

// These snapshots contain the real portfolio, so every object is written with
// access:"private" — readable only with the store token, never by URL.
async function blobRead<T>(name: string): Promise<Entry<T> | null> {
  try {
    const { get } = await import("@vercel/blob");
    // useCache:false — a CDN-cached copy would defeat the freshness check.
    const res = await get(BLOB_PREFIX + name, { access: "private", useCache: false });
    if (!res?.stream) return null;
    return (await new Response(res.stream).json()) as Entry<T>;
  } catch {
    return null; // Blob is optional infrastructure — never let it break a request
  }
}

async function blobWrite<T>(name: string, entry: Entry<T>): Promise<void> {
  try {
    const { put } = await import("@vercel/blob");
    await put(BLOB_PREFIX + name, JSON.stringify(entry), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  } catch {
    /* snapshot mirroring is best-effort */
  }
}

export interface CacheRead<T> {
  value: T;
  ageMs: number;
  fresh: boolean;
}

const toRead = <T>(entry: Entry<T> | null, freshMs: number): CacheRead<T> | null => {
  if (!entry || typeof entry.at !== "number") return null;
  const ageMs = Date.now() - entry.at;
  return { value: entry.value, ageMs, fresh: ageMs < freshMs };
};

export async function readDiskCache<T>(name: string, freshMs: number): Promise<CacheRead<T> | null> {
  // Fast path: this instance's own /tmp (or the permanent .cache/ locally).
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, name), "utf8");
    const local = toRead(JSON.parse(raw) as Entry<T>, freshMs);
    if (local) return local;
  } catch {
    /* nothing local — fall through to Blob */
  }

  if (!USE_BLOB) return null;
  const remote = await blobRead<T>(name);
  const read = toRead(remote, freshMs);
  // Seed /tmp so the rest of this instance's life reads locally.
  if (read && remote) {
    fs.mkdir(CACHE_DIR, { recursive: true })
      .then(() => fs.writeFile(path.join(CACHE_DIR, name), JSON.stringify(remote), "utf8"))
      .catch(() => undefined);
  }
  return read;
}

export async function writeDiskCache<T>(name: string, value: T): Promise<void> {
  const entry: Entry<T> = { at: Date.now(), value };
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    // Write-then-rename so a crash mid-write can't leave a truncated file behind.
    const file = path.join(CACHE_DIR, name);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry), "utf8");
    await fs.rename(tmp, file);
  } catch {
    /* cache is an optimisation — never fail the request over it */
  }
  // Mirror to Blob so the NEXT cold instance doesn't have to rebuild at all.
  if (USE_BLOB) await blobWrite(name, entry);
}

/**
 * Route-level in-memory snapshots, registered by name so another route can drop
 * them. Route files can only export handlers, so a shared registry is how one
 * route invalidates another's memory cache.
 */
const memoryCaches = ((globalThis as Record<string, unknown>).__memoryCaches ??= new Map<string, unknown>()) as Map<string, unknown>;
export const memGet = <T>(name: string): T | null => (memoryCaches.get(name) as T | undefined) ?? null;
export const memSet = <T>(name: string, value: T): void => void memoryCaches.set(name, value);

/**
 * Drop a cached entry everywhere it lives — memory, /tmp and Blob. Needed when the
 * inputs to a snapshot change (e.g. editing net deposits): without this the stale
 * snapshot keeps being served for its whole stale-serve window and the edit looks
 * like it did nothing.
 */
export async function deleteDiskCache(name: string): Promise<void> {
  memoryCaches.delete(name);
  try {
    await fs.unlink(path.join(CACHE_DIR, name));
  } catch {
    /* nothing local */
  }
  if (!USE_BLOB) return;
  try {
    const { del } = await import("@vercel/blob");
    await del(BLOB_PREFIX + name);
  } catch {
    /* best effort */
  }
}

/** Guard so concurrent requests on one instance trigger a single refresh. */
const inFlight = ((globalThis as Record<string, unknown>).__diskCacheInFlight ??= new Map<string, Promise<unknown>>()) as Map<string, Promise<unknown>>;

export function refreshOnce<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(name) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn()
    .then(async (v) => {
      await writeDiskCache(name, v);
      return v;
    })
    .finally(() => inFlight.delete(name));
  inFlight.set(name, p);
  return p;
}
