"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/analytics";
import { invalidatePies, type PieLike } from "@/lib/allocation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Trading212's API exposes a pie's cost basis but never its net deposits, and the
 * two diverge as soon as dividends are reinvested or a position is sold. The real
 * figures therefore have to be entered by hand — this dialog is how, so a deposit
 * no longer means editing a file, an env var and redeploying.
 */
export default function NetDepositsEditor({
  pies,
  currency,
  open,
  onClose,
}: {
  pies: PieLike[];
  currency: string;
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valueOf = (p: PieLike) => draft[p.name] ?? String(p.netDeposits ?? p.invested ?? 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const values: Record<string, number> = {};
      for (const p of pies) {
        const n = Number((draft[p.name] ?? "").replace(",", "."));
        if (draft[p.name] !== undefined && Number.isFinite(n) && n >= 0) values[p.name] = n;
      }
      if (Object.keys(values).length === 0) {
        onClose();
        return;
      }
      const res = await fetch("/api/net-deposits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.message ?? "Could not save.");
        return;
      }
      // The server already dropped its pies/overview snapshots. Clear the client's
      // caches too — the dashboard repaints from a sessionStorage snapshot, which
      // would otherwise put the old figures straight back on screen.
      invalidatePies();
      try {
        sessionStorage.removeItem("dividend-tracker-snapshot-v1");
      } catch {
        /* storage unavailable — the reload still refetches */
      }
      onClose();
      window.location.reload();
    } catch {
      setError("Could not reach the API.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>Invested per category</DialogTitle>
        <DialogDescription>
          Net deposits — money you put in, minus what you took out. Trading212 doesn&apos;t expose this per pie, so update it here when you deposit.
        </DialogDescription>

        <div className="mt-4 space-y-2.5">
          {pies.map((p) => (
            <label key={p.name} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate" title={p.name}>
                {p.name}
              </span>
              <span className="num shrink-0 text-[11px] text-muted-2" title="Current market value">
                {formatMoney(p.value, currency, 0)}
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={valueOf(p)}
                onChange={(e) => setDraft((d) => ({ ...d, [p.name]: e.target.value }))}
                className="num w-28 shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-[var(--primary)]"
              />
            </label>
          ))}
        </div>

        {error && <p className="mt-3 text-xs text-red">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
