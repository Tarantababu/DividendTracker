import { NextRequest, NextResponse, after } from "next/server";
import { readDiskCache, refreshOnce } from "@/lib/diskCache";
import { getAccountSummary, syncDividends, syncTransactions, T212Error } from "@/lib/t212";
import { contributionStats, externalCashflows, xirr } from "@/lib/fire";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export interface FirePayload {
  currency: string;
  totalValue: number;
  netContributions: number;
  growth: number; // totalValue - netContributions (all-time earnings incl. dividends & interest)
  xirrPct: number | null; // money-weighted annual return
  monthlyContribution12m: number; // avg net contribution over trailing 12 months
  dividends12m: number;
  dividendsMonthly12m: number;
  firstFlowDate: string | null;
  fetchedAt: string;
}

const DISK_FILE = "fire-snapshot.json";
const FRESH_MS = 10 * 60 * 1000;
const STALE_SERVE_MS = 7 * 24 * 60 * 60 * 1000;

async function build(force: boolean): Promise<FirePayload> {
    const [summary, tx, dividends] = await Promise.all([getAccountSummary(), syncTransactions(force), syncDividends(force)]);

    const flows = externalCashflows(tx.items);
    const stats = contributionStats(flows);
    const rate = xirr(flows, summary.totalValue);

    const divCutoff = Date.now() - 365.25 * 86400_000;
    const dividends12m = dividends.items.filter((d) => Date.parse(d.paidOn) >= divCutoff).reduce((sum, d) => sum + d.amount, 0);

    const payload: FirePayload = {
      currency: summary.currency ?? "EUR",
      totalValue: summary.totalValue,
      netContributions: stats.netContributions,
      growth: summary.totalValue - stats.netContributions,
      xirrPct: rate === null ? null : rate * 100,
      monthlyContribution12m: stats.monthlyAvg12m,
      dividends12m,
      dividendsMonthly12m: dividends12m / 12,
      firstFlowDate: stats.firstFlowDate,
      fetchedAt: new Date().toISOString(),
    };
    return payload;
}

export async function GET(req: NextRequest) {
  // Deposits and withdrawals come from the transaction history. Rebuilding it means
  // paginating the full history through a 1-req/5s API, which is why this page felt
  // slow: every cold instance paid for it before rendering anything. Serve the last
  // snapshot immediately and refresh behind the response instead.
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  let disk: Awaited<ReturnType<typeof readDiskCache<FirePayload>>> = null;
  try {
    disk = force ? null : await readDiskCache<FirePayload>(DISK_FILE, FRESH_MS);
    if (disk && disk.ageMs < STALE_SERVE_MS) {
      if (!disk.fresh) after(() => refreshOnce(DISK_FILE, () => build(false)).catch(() => undefined));
      return NextResponse.json(disk.fresh ? disk.value : { ...disk.value, stale: true });
    }
    return NextResponse.json(await refreshOnce(DISK_FILE, () => build(force)));
  } catch (err) {
    if (disk) return NextResponse.json({ ...disk.value, stale: true });
    if (err instanceof T212Error) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.code === "MISSING_CREDENTIALS" ? 428 : 502 });
    }
    return NextResponse.json({ error: "UNKNOWN", message: String(err) }, { status: 500 });
  }
}
