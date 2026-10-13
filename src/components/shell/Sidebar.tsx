"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { MODULE_COLOR } from "./nav-colors";
import type { NavStats } from "@/lib/nav-stats";

type Item = { href: string; label: string };
type Group = { id: string; title: string; icon: string; items: Item[] };

const KEY_COLLAPSED = "hifi.sidebar.collapsed";
const KEY_OPEN = "hifi.sidebar.open";

const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: the menu still works */ } };

// Grouped, collapsible navigation. Each group is a dropdown; the group holding the current page opens by itself;
// the whole bar can shrink to icons. Choices are remembered in this browser only.
export default function Sidebar({ groups, stats, mobileOpen, onClose }: { groups: Group[]; stats: NavStats; mobileOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<string[]>([]);

  useEffect(() => {
    setCollapsed(read(KEY_COLLAPSED, false));
    setOpen(read<string[]>(KEY_OPEN, ["overview"]));
  }, []);

  // The most specific matching link is the active one, so /leads/worklists does not also light up /leads
  const all = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.id })));
  const active = all.filter((i) => pathname === i.href || pathname.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
  const activeGroup = active?.group;

  useEffect(() => {
    if (activeGroup) setOpen((o) => (o.includes(activeGroup) ? o : [...o, activeGroup]));
  }, [activeGroup]);

  const toggleGroup = (id: string) => setOpen((o) => { const n = o.includes(id) ? o.filter((x) => x !== id) : [...o, id]; write(KEY_OPEN, n); return n; });
  const toggleCollapsed = () => setCollapsed((c) => { write(KEY_COLLAPSED, !c); return !c; });

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-sidebar-fg transition-[width,transform] duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 ${collapsed ? "md:w-[68px]" : "md:w-64"} w-72 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Main navigation"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 px-4">
          <Image src="/logo.png" alt="Hifi One" width={32} height={32} className="rounded-lg" priority />
          {!collapsed && <span className="text-[15px] font-semibold tracking-tight text-white">Hifi One</span>}
          <button type="button" onClick={onClose} className="ml-auto rounded-md p-1 text-white/70 hover:bg-white/10 md:hidden" aria-label="Close menu"><Icon name="close" /></button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 [scrollbar-width:thin]">
          {groups.map((g) => {
            const isOpen = open.includes(g.id) && !collapsed;
            const holdsActive = g.id === activeGroup;
            return (
              <div key={g.id} className="mb-0.5">
                {collapsed ? (
                  <Link href={g.items[0].href} title={g.title} className={`relative flex h-10 items-center justify-center rounded-lg ${holdsActive ? "bg-white/12" : "hover:bg-white/8"}`}>
                    <Chip color={MODULE_COLOR[g.id]} on={holdsActive}><Icon name={g.icon} className="h-4 w-4" /></Chip>
                    {stats.badges[g.id] ? <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-brand ring-2 ring-sidebar" /> : null}
                  </Link>
                ) : (
                  <button
                    type="button" onClick={() => toggleGroup(g.id)} aria-expanded={isOpen} aria-controls={`nav-${g.id}`}
                    className={`group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-all duration-150 hover:translate-x-0.5 ${holdsActive ? "text-white" : "text-sidebar-fg hover:bg-white/8 hover:text-white"}`}
                  >
                    <Chip color={MODULE_COLOR[g.id]} on={holdsActive}><Icon name={g.icon} className="h-4 w-4" /></Chip>
                    <span className="flex-1 text-left">{g.title}</span>
                    {stats.badges[g.id] ? <span title={g.id === "crm" ? "Follow-ups due" : "Overdue tasks"} className="min-w-5 rounded-full bg-brand px-1.5 text-center text-[11px] font-semibold leading-5 text-white [animation:pop_.3s_ease-out]">{stats.badges[g.id]}</span> : null}
                    <Icon name="chevron" className={`h-3.5 w-3.5 opacity-60 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                )}
                {isOpen && (
                  <ul id={`nav-${g.id}`} className="mb-1 ml-[22px] mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                    {g.items.map((i) => {
                      const on = active?.href === i.href;
                      return (
                        <li key={i.href}>
                          <Link href={i.href} onClick={onClose} aria-current={on ? "page" : undefined}
                            className={`relative block rounded-md px-3 py-1.5 text-[13px] transition-all duration-150 hover:translate-x-1 ${on ? "bg-gradient-to-r from-white/15 to-transparent font-medium text-white" : "text-sidebar-fg/80 hover:bg-white/8 hover:text-white"}`}>
                            {on && <span aria-hidden className="absolute -left-[13px] top-1.5 h-[18px] w-0.5 rounded-full" style={{ background: MODULE_COLOR[g.id] ?? "var(--accent)" }} />}
                            {i.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="hidden shrink-0 border-t border-white/10 p-2 md:block">
          <button type="button" onClick={toggleCollapsed} className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[13px] text-sidebar-fg hover:bg-white/8 hover:text-white" aria-label={collapsed ? "Expand menu" : "Collapse menu"}>
            <Icon name="menu" />{!collapsed && <span>Collapse menu</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

function Chip({ color = "#5648e8", on, children }: { color?: string; on: boolean; children: React.ReactNode }) {
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-transform duration-150 group-hover:scale-110 ${on ? "shadow-lg" : "opacity-90"}`}
      style={{ background: on ? `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, #fff))` : `color-mix(in srgb, ${color} 55%, #1e2247)`, boxShadow: on ? `0 4px 14px color-mix(in srgb, ${color} 55%, transparent)` : undefined }}>{children}</span>
  );
}
