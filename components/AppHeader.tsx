"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    <header className="sticky top-0 z-40 border-b border-border bg-[color-mix(in_srgb,var(--background)_82%,transparent)] backdrop-blur-md print:hidden">
      <div className="mx-auto flex h-13 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--primary)] text-[11px] font-bold text-white">D</span>
          <span className="hidden sm:inline">Dividend Tracker</span>
        </Link>
        {/* min-w-0 lets this flex child shrink so overflow-x-auto actually scrolls
            instead of forcing the whole page wider than the viewport on phones. */}
        <nav className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                pathname === l.href ? "bg-[var(--primary)] text-white" : "text-muted hover:bg-card-hover hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
