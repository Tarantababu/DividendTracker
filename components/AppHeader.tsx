"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/digest", label: "Daily digest" },
  { href: "/fire", label: "FIRE" },
  { href: "/budget", label: "Budget" },
  { href: "/videos", label: "Videos" },
  { href: "/signals", label: "Signals" },
  { href: "/tax-report", label: "Tax report" },
  { href: "/simulator", label: "Simulator" },
  { href: "/rent-vs-buy", label: "Rent vs Buy" },
];

export default function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[color-mix(in_srgb,var(--background)_85%,transparent)] backdrop-blur-md print:hidden">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex size-6 items-center justify-center rounded-md bg-[var(--primary)] text-[11px] font-bold text-[var(--primary-fg)]">D</span>
          <span className="hidden sm:inline">Dividend Tracker</span>
        </Link>
        {/* min-w-0 lets this flex child shrink so overflow-x-auto actually scrolls
            instead of forcing the whole page wider than the viewport on phones. */}
        <nav className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-2 hover:bg-card-hover hover:text-foreground",
                )}
              >
                {l.label}
                {/* Underline marker reads as navigation; a filled pill competes
                    with the primary action colour used for buttons. */}
                {active && <span className="absolute inset-x-2.5 -bottom-[7px] h-0.5 rounded-full bg-[var(--primary)]" />}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
