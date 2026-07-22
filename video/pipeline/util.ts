// Shared plumbing for the episode pipeline: env loading from the app's
// .env.local, episode folder layout, ISO-week ids, audio duration via afinfo.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VIDEO_ROOT = path.resolve(__dirname, "..");
export const APP_ROOT = path.resolve(VIDEO_ROOT, "..");
export const EPISODES_DIR = path.join(VIDEO_ROOT, "episodes");

export interface VideoConfig {
  baseUrl: string;
  channelName: string;
  language: string;
  privacyMode: "full" | "hybrid" | "percent";
  targetMinutes: number;
  storyline: string;
  screenshots: Record<string, string>;
  voice: {
    provider: string; // "dia-remote" | "dia" | "openai" | "say"
    model: string;
    voice: string;
    instructions?: string;
    fallbackProvider: string;
    // Local Dia model (nari-labs/dia). Requires a Python env with the `dia`
    // package installed — see video/README.md. Falls back automatically if absent.
    dia?: { pythonBin?: string; model?: string; device?: string; seed?: number };
    // Hosted Dia (real nari-labs/dia on Replicate) — no local install. Needs
    // REPLICATE_API_TOKEN in .env.local. Falls back automatically if the token is absent.
    diaRemote?: { model?: string; cfgScale?: number; temperature?: number; topP?: number; seed?: number };
  };
  broll: { enabled: boolean; maxClipMb: number; orientation: string };
  music: { volume: number };
  render: { width: number; height: number; fps: number; minFreeDiskGb: number };
  macroSymbols: Array<{ symbol: string; name: string }>;
}

export function loadConfig(): VideoConfig {
  return JSON.parse(fs.readFileSync(path.join(VIDEO_ROOT, "config.json"), "utf8")) as VideoConfig;
}

/** Load the app's .env.local into process.env (no dotenv dependency). */
export function loadEnv(): void {
  const file = path.join(APP_ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** ISO week id like "2026-W29" (episodes are weekly). */
export function isoWeekId(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function episodeDir(week = isoWeekId()): string {
  const dir = path.join(EPISODES_DIR, week);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Most recent episode folder before `week` (for week-over-week diffs). */
export function previousEpisodeDir(week = isoWeekId()): string | null {
  if (!fs.existsSync(EPISODES_DIR)) return null;
  const dirs = fs
    .readdirSync(EPISODES_DIR)
    .filter((d) => /^\d{4}-W\d{2}$/.test(d) && d < week)
    .sort();
  return dirs.length ? path.join(EPISODES_DIR, dirs[dirs.length - 1]) : null;
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/** Audio duration in seconds via macOS afinfo. */
export function audioDuration(file: string): number {
  const out = execFileSync("/usr/bin/afinfo", [file], { encoding: "utf8" });
  const m = out.match(/estimated duration:\s*([\d.]+)/);
  if (!m) throw new Error(`afinfo gave no duration for ${file}`);
  return parseFloat(m[1]);
}

/** Free space on / in GB (MB-precision, so sub-GB amounts aren't rounded to 0). */
export function freeDiskGb(): number {
  const out = execFileSync("/bin/df", ["-m", "/"], { encoding: "utf8" });
  const line = out.trim().split("\n").pop() ?? "";
  const availMb = Number(line.split(/\s+/)[3]) || 0;
  return availMb / 1024;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fmtEur = (v: number, digits = 0) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: digits }).format(v);

export const fmtPct = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
