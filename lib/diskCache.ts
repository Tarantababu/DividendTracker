import fs from "fs/promises";
import path from "path";
import { CACHE_DIR } from "./cacheDir";

/**
 * Small JSON cache on disk, used to survive what in-memory caches can't: a cold
 * serverless instance. Trading212's per-endpoint limits (1 req / 5s on several
 * routes) mean rebuilding from scratch costs tens of seconds, so serving a
 * slightly stale snapshot instantly and refreshing behind the response is far
 * better than making the page wait.
 */
interface Entry<T> {
  at: number;
  value: T;
}

export interface CacheRead<T> {
  value: T;
  ageMs: number;
  fresh: boolean;
}

export async function readDiskCache<T>(name: string, freshMs: number): Promise<CacheRead<T> | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, name), "utf8");
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || typeof entry.at !== "number") return null;
    const ageMs = Date.now() - entry.at;
    return { value: entry.value, ageMs, fresh: ageMs < freshMs };
  } catch {
    return null;
  }
}

export async function writeDiskCache<T>(name: string, value: T): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    // Write-then-rename so a crash mid-write can't leave a truncated file behind.
    const file = path.join(CACHE_DIR, name);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ at: Date.now(), value } satisfies Entry<T>), "utf8");
    await fs.rename(tmp, file);
  } catch {
    /* cache is an optimisation — never fail the request over it */
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
