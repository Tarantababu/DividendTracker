// Parse an N26 transactions CSV export into the same RawTx shape the GoCardless
// path produces, so everything downstream (categorize, summarize, FIRE) is shared.
// N26's export format has shifted over the years; header matching is fuzzy and the
// delimiter (comma vs semicolon) and decimal style (dot vs comma) are auto-detected.
import type { RawTx } from "./bank";

/** Split one CSV line honoring double-quoted fields. */
function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseAmount(s: string): number {
  let v = s.replace(/["\s]/g, "");
  if (!v) return NaN;
  // Decimal comma (e.g. "-1.234,56") vs decimal dot (e.g. "-1,234.56" / "-12.34")
  if (/,\d{1,2}$/.test(v) && !/\.\d{1,2}$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(/,/g, "");
  return Number(v);
}

function normDate(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  let m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})/); // DD.MM.YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/); // MM/DD/YYYY (N26 US-style)
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return t.slice(0, 10);
}

const find = (headers: string[], ...needles: string[]) => headers.findIndex((h) => needles.some((n) => h.includes(n)));

export class CsvError extends Error {}

export function parseN26Csv(text: string): RawTx[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new CsvError("The file has no transaction rows.");

  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitRow(lines[0], delim).map((h) => h.toLowerCase());

  const iDate = find(headers, "booking date", "date");
  const iPayee = find(headers, "partner name", "payee", "beneficiary", "merchant");
  const iRef = find(headers, "payment reference", "reference", "verwendungszweck");
  // Prefer the account-currency amount column; fall back to a generic "amount"
  let iAmount = find(headers, "amount (eur)", "amount (€)", "betrag");
  if (iAmount < 0) iAmount = find(headers, "amount");

  if (iDate < 0 || iAmount < 0) {
    throw new CsvError("Couldn't find Date / Amount columns — is this an N26 transactions CSV?");
  }

  const rows: RawTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i], delim);
    const amount = parseAmount(cols[iAmount] ?? "");
    const date = normDate(cols[iDate] ?? "");
    if (!isFinite(amount) || !date) continue;
    const payee = (iPayee >= 0 ? cols[iPayee] : "") || "";
    const reference = (iRef >= 0 ? cols[iRef] : "") || "";
    rows.push({
      transactionId: `csv-${date}-${i}-${amount}`,
      bookingDate: date,
      transactionAmount: { amount: amount.toFixed(2), currency: "EUR" },
      creditorName: amount < 0 ? payee : "",
      debtorName: amount >= 0 ? payee : "",
      remittanceInformationUnstructured: reference || payee,
      pending: false,
    });
  }
  if (rows.length === 0) throw new CsvError("No valid rows parsed from the file.");
  return rows;
}
