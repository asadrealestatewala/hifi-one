"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Icon from "./Icon";
import { MODULE_COLOR } from "./nav-colors";
import Avatar from "@/components/ui/Avatar";
import ArrangeMenu from "./ArrangeMenu";
import type { NavStats } from "@/lib/nav-stats";
import { SIDEBAR_THEMES, moveShown, type MenuPrefs } from "@/lib/menu-layout";
import { saveMenuAction } from "@/app/(app)/menu/actions";

type Item = { href: string; label: string };
type Group = { id: string; title: string; icon: string; items: Item[] };

const KEY_COLLAPSED = "hifi.sidebar.collapsed";
const KEY_OPEN = "hifi.sidebar.open";

const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: the menu still works */ } };

// Grouped, collapsible navigation. Each group is a dropdown; the group holding the current page opens by itself;
// the whole bar can shrink to icons. Open and collapsed state is remembered in this browser only; the group order (drag a group onto
// another), icon colours and sidebar colour are the person's saved menu (see ArrangeMenu) and follow them to every device.
export default function Sidebar({ groups: arranged, allGroups, menuPrefs, stats, name, roles, userId, signOut, mobileOpen, onClose }: { groups: Group[]; allGroups: Group[]; menuPrefs: MenuPrefs; stats: NavStats; name: string; roles: string; userId: string; signOut: () => Promise<void>; mobileOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  // Order shown right away while a drag is being saved; the server's order takes over after the refresh.
  const [order, setOrder] = useState(menuPrefs.order);
  const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [, start] = useTransition();
  useEffect(() => setOrder(menuPrefs.order), [menuPrefs.order]);
  const pos = new Map(order.map((id, i) => [id, i]));
  const groups = [...arranged].sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
  const theme = SIDEBAR_THEMES.find((t) => t.id === menuPrefs.theme);
  const themeStyle = theme?.bg ? ({ "--sidebar": theme.bg, "--sidebar-fg": theme.fg } as React.CSSProperties) : undefined;
  const colorOf = (id: string) => menuPrefs.colors[id] ?? MODULE_COLOR[id];

  const drop = (to: string) => {
    if (!drag || drag.from === to) { setDrag(null); return; }
    const next = moveShown(order, groups.map((g) => g.id), drag.from, to);
    setDrag(null);
    setOrder(next);
    setSaveError(false);
    start(async () => {
      try { await saveMenuAction({ ...menuPrefs, order: next }); router.refresh(); } catch { setOrder(menuPrefs.order); setSaveError(true); }
    });
  };
  // Desktop drag and drop on the group rows; on touch screens the Customize menu dialog has drag handles.
  // Only the group header starts a drag; the whole group (header and open pages) is the drop target.
  const dragHandle = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); setDrag({ from: id, over: null }); },
    onDragEnd: () => setDrag(null),
  });
  const dropZone = (id: string) => ({
    onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (drag.over !== id) setDrag({ ...drag, over: id }); },
    onDrop: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); drop(id); },
  });

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
        style={themeStyle}
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
              <div key={g.id} {...dropZone(g.id)} className={`mb-0.5 rounded-lg transition ${drag?.from === g.id ? "opacity-40" : ""} ${drag && drag.over === g.id && drag.from !== g.id ? "ring-2 ring-white/40" : ""}`}>
                {collapsed ? (
                  <Link {...dragHandle(g.id)} href={g.items[0].href} title={g.title} className={`relative flex h-10 items-center justify-center rounded-lg ${holdsActive ? "bg-white/12" : "hover:bg-white/8"}`}>
                    <Chip color={colorOf(g.id)} on={holdsActive}><Icon name={g.icon} className="h-4 w-4" /></Chip>
                    {stats.badges[g.id] ? <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-brand ring-2 ring-sidebar" /> : null}
                  </Link>
                ) : (
                  <button
                    {...dragHandle(g.id)} title="Click to open, drag to move"
                    type="button" onClick={() => toggleGroup(g.id)} aria-expanded={isOpen} aria-controls={`nav-${g.id}`}
                    className={`group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-all duration-150 hover:translate-x-0.5 ${holdsActive ? "text-white" : "text-sidebar-fg hover:bg-white/8 hover:text-white"}`}
                  >
                    <Chip color={colorOf(g.id)} on={holdsActive}><Icon name={g.icon} className="h-4 w-4" /></Chip>
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
                            {on && <span aria-hidden className="absolute -left-[13px] top-1.5 h-[18px] w-0.5 rounded-full" style={{ background: colorOf(g.id) ?? "var(--accent)" }} />}
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

        {saveError && !collapsed && <p role="alert" className="mx-3 mb-1 rounded-md bg-brand/20 px-2 py-1 text-[11px] text-white">The new order was not saved. Try again.</p>}
        {!collapsed && <ArrangeMenu groups={allGroups} prefs={menuPrefs} />}
        <AccountBlock name={name} roles={roles} userId={userId} signOut={signOut} collapsed={collapsed} onNavigate={onClose} />
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
      style={{ background: on ? `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, #fff))` : `color-mix(in srgb, ${color} 55%, color-mix(in srgb, var(--sidebar) 92%, #fff))`, boxShadow: on ? `0 4px 14px color-mix(in srgb, ${color} 55%, transparent)` : undefined }}>{children}</span>
  );
}

// Who is signed in, at the bottom of the menu: picture, name and role, the account menu, and a sign-out button.
function AccountBlock({ name, roles, userId, signOut, collapsed, onNavigate }: { name: string; roles: string; userId: string; signOut: () => Promise<void>; collapsed: boolean; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", on); document.removeEventListener("keydown", key); };
  }, [open]);
  const items: [string, string, string][] = [["/me/profile", "My profile", "user"], ["/account/security", "Two-step verification", "shield"], ["/account/password", "Change password", "key"], ["/me/calendar", "Calendar feed", "calendar"], ["/notifications", "Notifications", "bell"]];
  return (
    <div ref={box} className="relative shrink-0 border-t border-white/10 p-2">
      {open && (
        <div role="menu" className={`absolute bottom-full z-50 mb-2 rounded-xl border border-white/10 bg-sidebar p-1.5 shadow-2xl [animation:fade_.12s_ease-out] ${collapsed ? "left-2 w-56" : "inset-x-2"}`}>
          {items.map(([href, label, icon]) => (
            <Link key={href} href={href} role="menuitem" onClick={() => { setOpen(false); onNavigate(); }} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-sidebar-fg transition hover:bg-white/10 hover:text-white"><Icon name={icon} className="h-4 w-4" />{label}</Link>
          ))}
        </div>
      )}
      <div className={`flex items-center gap-2 ${collapsed ? "md:flex-col" : ""}`}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={`Account menu for ${name}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left transition hover:bg-white/10">
          <Avatar name={name} userId={userId} size={36} />
          {!collapsed && <span className="min-w-0 leading-tight"><span className="block truncate text-[13px] font-semibold text-white">{name}</span><span className="block truncate text-[11px] text-sidebar-fg">{roles}</span></span>}
        </button>
        <form action={signOut}><button title="Sign out" aria-label="Sign out" className="rounded-lg p-2 text-sidebar-fg transition hover:bg-white/10 hover:text-white"><Icon name="logout" className="h-[18px] w-[18px]" /></button></form>
      </div>
    </div>
  );
}
