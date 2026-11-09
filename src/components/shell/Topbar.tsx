"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { loadBell, readBellAll, readBellItem, type BellItem } from "@/app/(app)/notifications/actions";

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

export default function Topbar({ unread, chatUnread, quick, canSearch, onMenu, extra }: {
  unread: number; chatUnread: number | null; quick: Quick[]; canSearch: boolean; onMenu: () => void; extra?: React.ReactNode;
}) {
  const [menu, setMenu] = useState<"" | "quick" | "bell">("");
  const [count, setCount] = useState(unread);
  const [items, setItems] = useState<BellItem[] | null>(null);
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useClickAway(box, () => setMenu(""));

  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);

  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("hifi.theme", next); } catch { /* private mode: the choice just is not remembered */ }
    setDark(!dark);
  };

  useEffect(() => { setCount(unread); }, [unread]);

  // The bell opens a panel over the current page, so the page and its unsaved state stay put.
  const toggleBell = async () => {
    if (menu === "bell") { setMenu(""); return; }
    setMenu("bell");
    try { const r = await loadBell(); setItems(r.items); setCount(r.unread); } catch { setItems((cur) => cur ?? []); }
  };
  const open = async (n: BellItem) => {
    setMenu("");
    if (!n.read) {
      setCount((c) => Math.max(0, c - 1));
      setItems((cur) => cur && cur.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      void readBellItem(n.id).catch(() => {});
    }
    if (n.link) router.push(n.link);
  };
  const readAll = async () => {
    setCount(0);
    setItems((cur) => cur && cur.map((i) => ({ ...i, read: true })));
    void readBellAll().catch(() => {});
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur md:px-6">
      <button type="button" onClick={onMenu} className="rounded-lg p-2 text-muted hover:bg-hover md:hidden" aria-label="Open menu"><Icon name="menu" /></button>

      {canSearch && (
        <form action="/search" role="search" className="relative hidden max-w-md flex-1 sm:block">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" aria-label="Search everything" placeholder="Search clients, leads, invoices…" autoComplete="off"
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

        {extra}

        <button type="button" onClick={flip} className="rounded-lg p-2 text-muted hover:bg-hover hover:text-foreground" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
          <Icon name={dark ? "sun" : "moon"} />
        </button>

        {chatUnread !== null && (
          <Link href="/chat" className="relative rounded-lg p-2 text-muted hover:bg-hover hover:text-foreground" aria-label={`Team chat, ${chatUnread} unread`}>
            <Icon name="chat" />
            {chatUnread > 0 && <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-white">{chatUnread > 99 ? "99+" : chatUnread}</span>}
          </Link>
        )}

        <div className="sm:relative">
          <button type="button" onClick={toggleBell} aria-expanded={menu === "bell"} aria-haspopup="dialog" className="relative rounded-lg p-2 text-muted hover:bg-hover hover:text-foreground" aria-label={`Notifications, ${count} unread`}>
            <Icon name="bell" />
            {count > 0 && <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-white">{count > 99 ? "99+" : count}</span>}
          </button>
          {menu === "bell" && (
            <div role="dialog" aria-label="Notifications" className="absolute inset-x-3 top-full z-30 mt-2 flex max-h-[70vh] flex-col rounded-xl border border-border bg-surface shadow-lg sm:inset-x-auto sm:right-0 sm:w-96">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Notifications</p>
                {count > 0 && <button type="button" onClick={readAll} className="text-xs text-primary hover:underline">Mark all as read</button>}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {items === null && <p className="p-4 text-sm text-muted">Loading…</p>}
                {items?.length === 0 && <p className="p-4 text-sm text-muted">Nothing yet.</p>}
                {items?.map((n) => (
                  <button key={n.id} type="button" onClick={() => open(n)} className={`block w-full border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-hover ${n.read ? "" : "bg-brand/5"}`}>
                    <span className="block text-sm font-semibold">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-sm text-muted">{n.body}</span>}
                    <span className="block text-xs text-muted">{new Date(n.at).toLocaleString()}</span>
                  </button>
                ))}
              </div>
              <Link href="/notifications" onClick={() => setMenu("")} className="border-t border-border px-4 py-3 text-center text-sm font-medium text-primary hover:bg-hover">View all</Link>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
