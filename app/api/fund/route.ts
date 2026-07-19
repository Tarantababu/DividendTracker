import { NextRequest, NextResponse } from "next/server";
import type { FundInfo } from "@/lib/signals";
import { fetchFundInfo } from "@/lib/yahooFund";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 60;

export async function GET(req: NextRequest) {
  const rawParam = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = [...new Set(rawParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) return NextResponse.json({ error: "BAD_REQUEST", message: "Pass ?symbols=JEPQ,VUSA.L" }, { status: 400 });

  try {
    const settled = await Promise.allSettled(symbols.map(fetchFundInfo));
    const funds: FundInfo[] = [];
    settled.forEach((r) => {
      if (r.status === "fulfilled" && r.value) funds.push(r.value);
    });
    return NextResponse.json({ funds });
  } catch (err) {
    return NextResponse.json({ error: "UPSTREAM", message: String(err) }, { status: 502 });
  }
}
