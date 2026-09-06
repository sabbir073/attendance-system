"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { csrfToken } from "@/lib/client-signals";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export function AppShell({
  nav,
  user,
  variant,
  children,
}: {
  nav: NavItem[];
  user: { name: string; role: string; designation: string | null };
  variant: "portal" | "admin";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken() },
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const accent =
    variant === "admin" ? "bg-navy-600" : "bg-brand-600";

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 -translate-x-full border-r border-[var(--line)] bg-white transition-transform lg:static lg:translate-x-0",
          open && "translate-x-0",
        )}
      >
        <div className="flex h-16 items-center border-b border-[var(--line)] px-5">
          <Image
            src="/logo.svg"
            alt="DESCO"
            width={130}
            height={39}
            priority
            style={{ width: 130, height: "auto" }}
          />
        </div>

        <div className="px-3 py-2">
          <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {variant === "admin" ? "Administration" : "My workspace"}
          </p>
          <nav className="space-y-0.5">
            {nav.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/admin" &&
                  item.href !== "/dashboard" &&
                  pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                    active
                      ? `${accent} text-white shadow-sm`
                      : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-[var(--line)] p-3">
          <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-slate-800">
              {user.name}
            </p>
            <p className="truncate text-xs text-slate-500">
              {user.designation ?? user.role}
            </p>
          </div>
          <button
            onClick={logout}
            disabled={busy}
            className="btn-outline w-full btn-sm"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      {open ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--line)] bg-white/90 px-4 backdrop-blur lg:px-8">
          <button
            className="btn-outline btn-sm lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              Attendance Management System
            </p>
            <p className="truncate text-xs text-slate-500">
              Dhaka Electric Supply Company Limited
            </p>
          </div>
          {variant === "admin" ? (
            <span className="ml-auto badge bg-navy-100 text-navy-700">
              Admin
            </span>
          ) : null}
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/* --------------------------- icons --------------------------- */

const ico = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d={d}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ICONS = {
  home: ico("m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2Z"),
  clock: ico("M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"),
  calendar: ico(
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  ),
  user: ico("M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"),
  users: ico(
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm10 14v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  ),
  pin: ico("M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Zm-9 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"),
  shield: ico("m12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"),
  chart: ico("M3 3v18h18M7 16v-5m5 5V8m5 8v-3"),
  cog: ico(
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 2h-4l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  ),
  list: ico("M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"),
  face: ico(
    "M9 10h.01M15 10h.01M9 15c.8.7 1.9 1 3 1s2.2-.3 3-1M4 8V6a2 2 0 0 1 2-2h2m8 0h2a2 2 0 0 1 2 2v2m0 8v2a2 2 0 0 1-2 2h-2m-8 0H6a2 2 0 0 1-2-2v-2",
  ),
};
