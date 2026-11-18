"use client";

import RecordIcon from "@/components/ui/RecordIcon";
import { searchRecordsAction } from "@/app/(app)/search/actions";
import { matchDestinations, type Destination } from "@/lib/go-to";
import type { Group } from "@/lib/search";
import { recordTypeFromHref } from "@/lib/tint";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

// The one search: the top-bar box, the phone search button and Ctrl K / Cmd K all open it (the OPEN_SEARCH event).
// "Go to" lists the screens and tabs the person may open, with the path to each; the list is built on the server with the
// menu's rules (lib/go-to.ts). "Records" come from the same search as the Search page, as the person types.
export const OPEN_SEARCH = "hifi:open-search";
export function openSearch() { window.dispatchEvent(new Event(OPEN_SEARCH)); }

type Row = { section: string; href: string; label: string; hint: string; icon: string; kind: "page" | "create" | "record" | "all" };

export default function CommandPalette({ destinations, quick, canSearch }: {
  destinations: Destination[]; quick: { href: string; label: string; icon: string }[]; canSearch: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<{ q: string; groups: Group[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const term = q.trim();

  // Records, a moment after typing stops; an answer for older text is ignored.
  useEffect(() => {
    if (!open || !canSearch || term.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      searchRecordsAction(term).then((r) => { if (live) setRecords({ q: term, groups: r.groups }); }).catch(() => { if (live) setRecords({ q: term, groups: [] }); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [open, canSearch, term]);

  const rows = useMemo<Row[]>(() => {
    const trail = (d: Destination) => d.trail.join(" → ");
    if (!term) {
      return [
        ...quick.map((x) => ({ section: "Create", href: x.href, label: x.label, hint: "", icon: x.icon, kind: "create" as const })),
        ...destinations.slice(0, 8).map((d) => ({ section: "Go to", href: d.href, label: d.label, hint: trail(d), icon: d.icon, kind: "page" as const })),
      ];
    }
    const t = term.toLowerCase();
    const out: Row[] = matchDestinations(destinations, term, 8).map((d) => ({ section: "Go to", href: d.href, label: d.label, hint: trail(d), icon: d.icon, kind: "page" }));
    for (const x of quick) if (x.label.toLowerCase().includes(t)) out.push({ section: "Create", href: x.href, label: x.label, hint: "", icon: x.icon, kind: "create" });
    if (records && records.q === term) {
      for (const g of records.groups) for (const h of g.hits) out.push({ section: "Records", href: h.href, label: h.label, hint: [g.title, h.sub].filter(Boolean).join(" · "), icon: "search", kind: "record" });
    }
    if (canSearch && term.length >= 2) out.push({ section: "Records", href: `/search?q=${encodeURIComponent(term)}`, label: `See all results for “${term}”`, hint: "", icon: "search", kind: "all" });
    return out;
  }, [term, destinations, quick, records, canSearch]);
  const waiting = canSearch && term.length >= 2 && records?.q !== term;

  useEffect(() => {
    const show = () => { opener.current = document.activeElement as HTMLElement | null; setOpen(true); setQ(""); setActive(0); setRecords(null); };
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false); else show();
      }
    };
    window.addEventListener("keydown", k);
    window.addEventListener(OPEN_SEARCH, show);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener(OPEN_SEARCH, show); };
  }, [open]);
  useEffect(() => { if (open) input.current?.focus(); else opener.current?.focus?.(); }, [open]);
  useEffect(() => { if (active >= rows.length) setActive(0); }, [rows.length, active]);

  const go = (i: number) => {
    const r = rows[i];
    if (!r) return;
    setOpen(false);
    router.push(r.href);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const n = rows.length;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (n ? (a + 1) % n : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (n ? (a - 1 + n) % n : 0)); }
    else if (e.key === "Enter" && n) { e.preventDefault(); go(active); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onKeyDown={onKey}>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Icon name="search" className="h-4 w-4 text-muted" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={rows.length ? `palette-${active}` : undefined}
            aria-label="Search screens and records" placeholder="Type a screen, a setting, or a client, lead, invoice…" autoComplete="off" style={{ outline: "none" }} className="h-12 flex-1 bg-transparent text-sm" />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto p-1.5">
          {rows.map((r, i) => (
            <Fragment key={r.section + r.href + r.label}>
              {(i === 0 || rows[i - 1].section !== r.section) && (
                <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{r.section}</li>
              )}
              <li id={`palette-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(i)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-hover" : ""}`}>
                {r.kind === "all" ? <Icon name="search" className="h-4 w-4 text-muted" /> : <RecordIcon type={recordTypeFromHref(r.href)} size="sm" fallback={r.icon} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.label}</span>
                  {r.hint && <span className="block truncate text-xs text-muted">{r.hint}</span>}
                </span>
                {i === active && <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted sm:inline">Enter</kbd>}
              </li>
            </Fragment>
          ))}
          {waiting && <li role="presentation" className="px-3 py-2 text-xs text-muted">Looking through records…</li>}
          {rows.length === 0 && !waiting && <li role="presentation" className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{term}”. Try another word, like “leave”, “invoice” or “holidays”.</li>}
        </ul>
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted">↑ ↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  );
}
