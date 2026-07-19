import path from "path";
import os from "os";

/**
 * File-cache root. Locally: .cache/ in the project (persists across restarts).
 * On Vercel the deployment bundle (/var/task) is read-only — only /tmp is
 * writable, so caches live there and simply re-sync on cold starts.
 */
export const CACHE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "dividend-tracker-cache")
  : path.join(process.cwd(), ".cache");
