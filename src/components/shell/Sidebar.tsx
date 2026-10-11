"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "./Icon";

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
export default function Sidebar({ groups, mobileOpen, onClose }: { groups: Group[]; mobileOpen: boolean; onClose: () => void }) {
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
                  <Link href={g.items[0].href} title={g.title} className={`flex h-10 items-center justify-center rounded-lg ${holdsActive ? "bg-white/12 text-white" : "text-sidebar-fg hover:bg-white/8 hover:text-white"}`}>
                    <Icon name={g.icon} />
                  </Link>
                ) : (
                  <button
                    type="button" onClick={() => toggleGroup(g.id)} aria-expanded={isOpen} aria-controls={`nav-${g.id}`}
                    className={`group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors ${holdsActive ? "text-white" : "text-sidebar-fg hover:bg-white/8 hover:text-white"}`}
                  >
                    <Icon name={g.icon} className={`h-[18px] w-[18px] ${holdsActive ? "text-accent" : ""}`} />
                    <span className="flex-1 text-left">{g.title}</span>
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
                            className={`block rounded-md px-3 py-1.5 text-[13px] transition-colors ${on ? "bg-white/12 font-medium text-white" : "text-sidebar-fg/80 hover:bg-white/8 hover:text-white"}`}>
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
