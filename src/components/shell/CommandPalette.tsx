"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

type Entry = { href: string; label: string; hint: string; icon: string };

// Ctrl K / Cmd K: jump to any page the person is allowed to open, start a "create", or search everything. The lists come from the
// server-filtered navigation, so the palette never offers a page the person could not open.
export default function CommandPalette({ groups, quick, canSearch }: {
  groups: { id: string; title: string; icon: string; items: { href: string; label: string }[] }[];
  quick: { href: string; label: string; icon: string }[]; canSearch: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const all = useMemo<Entry[]>(() => [
    ...quick.map((x) => ({ href: x.href, label: x.label, hint: "Create", icon: x.icon })),
    ...groups.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, hint: g.title, icon: g.icon }))),
  ], [groups, quick]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term ? all.filter((e) => `${e.label} ${e.hint}`.toLowerCase().includes(term)) : all.slice(0, 12);
    const rank = (e: Entry) => (e.label.toLowerCase().startsWith(term) ? 0 : 1);
    return (term ? [...list].sort((a, b) => rank(a) - rank(b)) : list).slice(0, 30);
  }, [all, q]);
  const searchRow = canSearch && q.trim().length > 0;
  const total = results.length + (searchRow ? 1 : 0);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement | null;
        setOpen((o) => !o); setQ(""); setActive(0);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); else opener.current?.focus?.(); }, [open]);

  const go = (i: number) => {
    setOpen(false);
    if (i < results.length) router.push(results[i].href);
    else if (searchRow) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (total ? (a + 1) % total : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (total ? (a - 1 + total) % total : 0)); }
    else if (e.key === "Enter" && total) { e.preventDefault(); go(active); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onKeyDown={onKey}>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Icon name="search" className="h-4 w-4 text-muted" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={`palette-${active}`}
            aria-label="Go to a page or search" placeholder="Go to a page, create something, or search…" autoComplete="off" className="h-12 flex-1 bg-transparent text-sm outline-none" />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {results.map((e, i) => (
            <li key={e.href + e.label + e.hint} id={`palette-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(i)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-hover" : ""}`}>
              <Icon name={e.icon} className="h-4 w-4 text-muted" /><span className="flex-1">{e.label}</span><span className="text-xs text-muted">{e.hint}</span>
            </li>
          ))}
          {searchRow && (
            <li id={`palette-${results.length}`} role="option" aria-selected={active === results.length} onMouseEnter={() => setActive(results.length)} onClick={() => go(results.length)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${active === results.length ? "bg-hover" : ""}`}>
              <Icon name="search" className="h-4 w-4 text-muted" /><span className="flex-1">Search everything for “{q.trim()}”</span><span className="text-xs text-muted">Search</span>
            </li>
          )}
          {total === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches.</li>}
        </ul>
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted">↑ ↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  );
}
