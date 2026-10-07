"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Bell, LogIn, LogOut, ShieldCheck } from "lucide-react";

export function Header() {
  const pathname = usePathname();
  const { ready, authenticated, user, login, logout } = usePrivy();

  const userEmail =
    user?.email?.address ??
    user?.linkedAccounts.find(
      (a): a is typeof a & { address: string } => a.type === "email" && "address" in a,
    )?.address;

  return (
    <header className="border-b border-[var(--rule)] bg-[var(--paper)] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden md:flex items-center gap-6 text-xs uppercase tracking-wider font-medium text-[var(--ink-2)]">
            <Link
              href="/facilities"
              className={`hover:text-[var(--ink)] transition-colors ${
                pathname.startsWith("/facilities")
                  ? "text-[var(--ink)] font-semibold border-b-2 border-[var(--ink)] py-4 -mb-[1px]"
                  : ""
              }`}
            >
              Credit Facilities
            </Link>
            <Link
              href="/evidence"
              className={`hover:text-[var(--ink)] transition-colors ${
                pathname.startsWith("/evidence")
                  ? "text-[var(--ink)] font-semibold border-b-2 border-[var(--ink)] py-4 -mb-[1px]"
                  : ""
              }`}
            >
              Evidence Chain
            </Link>
            <Link
              href="/alerts"
              className={`hover:text-[var(--ink)] transition-colors flex items-center gap-1.5 ${
                pathname.startsWith("/alerts")
                  ? "text-[var(--ink)] font-semibold border-b-2 border-[var(--ink)] py-4 -mb-[1px]"
                  : ""
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              Alerts
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle />

          {ready && (
            <>
              {authenticated ? (
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--ink-2)] px-2.5 py-1 rounded bg-[var(--paper-2)] border border-[var(--rule)]">
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--signal-ink)]" />
                    <span className="font-mono text-[11px] truncate max-w-[180px]">
                      {userEmail ?? "signed in"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => logout()}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[var(--rule)] text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)] transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign out</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => login()}
                  className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign in</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
