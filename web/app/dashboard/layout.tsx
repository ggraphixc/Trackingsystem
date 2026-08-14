"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangleIcon,
  BellIcon,
  CameraIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  DocumentTextIcon,
  LeafIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  WifiIcon,
  XMarkIcon,
} from "@/components/icons";
import NotificationBell from "@/components/notification-bell";
import { Logo } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: ShieldCheckIcon },
  { href: "/dashboard/devices", label: "My Devices", icon: DeviceMobileIcon },
  { href: "/dashboard/recovery", label: "Recovery", icon: AlertTriangleIcon },
  { href: "/dashboard/incidents", label: "Incidents", icon: DocumentTextIcon },
  { href: "/dashboard/serial-check", label: "Device Check", icon: SearchIcon },
  { href: "/dashboard/evidence", label: "Evidence", icon: CameraIcon },
  { href: "/dashboard/alerts", label: "Alerts", icon: BellIcon },
  { href: "/dashboard/offline-recovery", label: "Offline Recovery", icon: WifiIcon },
  { href: "/dashboard/agents", label: "Agents", icon: CrosshairIcon },
  { href: "/dashboard/impact", label: "Impact", icon: LeafIcon },
  { href: "/dashboard/admin", label: "Service health", icon: ServerIcon },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const Sidebar = (
    <div className="flex h-full flex-col gap-6 p-5">
      <Link href="/dashboard" className="px-1">
        <Logo />
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-ink-muted hover:bg-slate-100 hover:text-ink"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <Link
          href="/dashboard/incidents/new"
          onClick={() => setOpen(false)}
          className="btn-primary w-full"
        >
          <PlusIcon className="h-4 w-4" />
          Report lost phone
        </Link>
        <div className="mt-4 rounded-xl border border-slate-200 bg-gradient-to-br from-primary/5 to-accent/5 p-3.5 text-xs text-ink-muted">
          <p className="mb-1 font-semibold text-ink">Free forever</p>
          Vault, reporting, IMEI check & last-known location. No card needed.
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        {Sidebar}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-lift">
            <button
              className="absolute right-3 top-4 rounded-lg p-2 text-ink-muted hover:bg-slate-100"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
            {Sidebar}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-surface/80 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-ink-muted hover:bg-slate-100 lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Protected by Dravex
            </span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link
              href="/dashboard/track"
              className="btn-ghost hidden sm:inline-flex"
            >
              <CrosshairIcon className="h-4 w-4 text-accent" />
              Live tracking
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
