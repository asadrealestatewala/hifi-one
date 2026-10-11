"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

type Quick = { href: string; label: string; icon: string };

function useClickAway(ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", on); document.removeEventListener("keydown", key); };
  }, [ref, close]);
}

export default function Topbar({ name, roles, unread, quick, canSearch, signOut, onMenu }: {
  name: string; roles: string; unread: number; quick: Quick[]; canSearch: boolean; signOut: () => Promise<void>; onMenu: () => void;
}) {
  const [menu, setMenu] = useState<"" | "quick" | "profile">("");
  const [dark, setDark] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useClickAway(box, () => setMenu(""));

  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.current?.focus(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("hifi.theme", next); } catch { /* private mode: the choice just is not remembered */ }
    setDark(!dark);
  };
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur md:px-6">
      <button type="button" onClick={onMenu} className="rounded-lg p-2 text-muted hover:bg-hover md:hidden" aria-label="Open menu"><Icon name="menu" /></button>

      {canSearch && (
        <form action="/search" role="search" className="relative hidden max-w-md flex-1 sm:block">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input ref={search} name="q" aria-label="Search everything" placeholder="Search clients, leads, invoices…" autoComplete="off"
            className="h-9 w-full rounded-lg border border-transparent bg-hover pl-9 pr-14 text-sm outline-none transition focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20" />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-muted">Ctrl K</kbd>
        </form>
      )}
      <div className="flex-1 sm:hidden" />

      <div ref={box} className="flex items-center gap-1.5">
        {quick.length > 0 && (
          <div className="relative">
            <button type="button" onClick={() => setMenu(menu === "quick" ? "" : "quick")} aria-expanded={menu === "quick"} aria-haspopup="menu"
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white shadow-sm transition hover:bg-primary-dark">
              <Icon name="plus" className="h-4 w-4" /><span className="hidden sm:inline">Create</span>
            </button>
            {menu === "quick" && (
              <div role="menu" className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
                {quick.map((q) => (
                  <Link key={q.href + q.label} href={q.href} role="menuitem" onClick={() => setMenu("")} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-hover">
                    <Icon name={q.icon} className="h-4 w-4 text-muted" />{q.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <button type="button" onClick={flip} className="rounded-lg p-2 text-muted hover:bg-hover hover:text-foreground" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
          <Icon name={dark ? "sun" : "moon"} />
        </button>

        <Link href="/notifications" className="relative rounded-lg p-2 text-muted hover:bg-hover hover:text-foreground" aria-label={`Notifications, ${unread} unread`}>
          <Icon name="bell" />
          {unread > 0 && <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
        </Link>

        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === "profile" ? "" : "profile")} aria-expanded={menu === "profile"} aria-haspopup="menu"
            className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-hover">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials}</span>
            <span className="hidden text-left leading-tight lg:block"><span className="block text-[13px] font-medium">{name}</span><span className="block max-w-40 truncate text-[11px] text-muted">{roles}</span></span>
            <Icon name="down" className="hidden h-3.5 w-3.5 text-muted lg:block" />
          </button>
          {menu === "profile" && (
            <div role="menu" className="absolute right-0 mt-2 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
              <div className="px-3 py-2"><p className="text-sm font-medium">{name}</p><p className="text-xs text-muted">{roles}</p></div>
              <div className="my-1 border-t border-border" />
              {[["/account/security", "Two-step verification", "shield"], ["/account/password", "Change password", "key"], ["/me/calendar", "Calendar feed", "calendar"], ["/notifications", "Notifications", "bell"]].map(([href, label, icon]) => (
                <Link key={href} href={href} role="menuitem" onClick={() => setMenu("")} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-hover"><Icon name={icon} className="h-4 w-4 text-muted" />{label}</Link>
              ))}
              <div className="my-1 border-t border-border" />
              <form action={signOut}><button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-hover"><Icon name="logout" className="h-4 w-4 text-muted" />Sign out</button></form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
