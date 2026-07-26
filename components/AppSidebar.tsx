"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  CalendarClock,
  Flame,
  LayoutDashboard,
  LineChart,
  Menu,
  Receipt,
  Signal,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Two groups, like the kit: the daily surfaces first, tools underneath.
const GROUPS: { label: string; links: { href: string; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    label: "Main",
    links: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/digest", label: "Daily digest", icon: BookOpenText },
      { href: "/fire", label: "FIRE", icon: Flame },
      { href: "/budget", label: "Budget", icon: Wallet },
      { href: "/signals", label: "Signals", icon: Signal },
    ],
  },
  {
    label: "Tools",
    links: [
      { href: "/simulator", label: "Simulator", icon: LineChart },
      { href: "/rent-vs-buy", label: "Rent vs Buy", icon: CalendarClock },
      { href: "/tax-report", label: "Tax report", icon: Receipt },
      { href: "/videos", label: "Videos", icon: Video },
    ],
  },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2">
      {GROUPS.map((g) => (
        <div key={g.label} className="mb-5">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)]">{g.label}</div>
          <ul className="space-y-0.5">
            {g.links.map((l) => {
              const active = pathname === l.href;
              const Icon = l.icon;
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                      // Active = a white pill on the dark rail, exactly as the kit does it.
                      active
                        ? "bg-white font-semibold text-[#0d0d12] shadow-sm"
                        : "font-medium text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-white",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                    <span className="truncate">{l.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarInner({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-[var(--sidebar)] text-[var(--sidebar-fg)]">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-white text-sm font-bold text-[#0d0d12]">D</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">Dividend Tracker</div>
          <div className="truncate text-[11px] text-[var(--sidebar-muted)]">Trading212 · live</div>
        </div>
      </div>

      <NavLinks pathname={pathname} onNavigate={onNavigate} />

      {/* Account row pinned to the bottom, as in the kit */}
      <div className="mt-auto border-t border-white/10 px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-hover)] text-xs font-semibold">H</span>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">My portfolio</div>
            <div className="truncate text-[11px] text-[var(--sidebar-muted)]">Live account</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll behind the drawer.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* Desktop: fixed rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] lg:block print:hidden">
        <SidebarInner pathname={pathname} />
      </aside>

      {/* Mobile: compact top bar that opens the same rail as a drawer */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 backdrop-blur-md lg:hidden print:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="rounded-lg p-2 text-muted transition-colors hover:bg-card-hover hover:text-foreground"
        >
          <Menu className="size-5" />
        </button>
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex size-6 items-center justify-center rounded-md bg-[var(--sidebar)] text-[11px] font-bold text-white">D</span>
          Dividend Tracker
        </Link>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/50" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(84vw,var(--sidebar-width))]">
            <SidebarInner pathname={pathname} onNavigate={() => setOpen(false)} />
            <button
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
