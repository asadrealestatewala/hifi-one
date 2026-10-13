"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import Icon from "./Icon";
import { resetMenuAction, saveMenuAction } from "@/app/(app)/menu/actions";
import type { MenuGroup, MenuPrefs } from "@/lib/menu-layout";

// "Arrange menu": move groups up and down, and show or hide groups and single items. Applies to this person only.
export default function ArrangeMenu({ groups, prefs }: { groups: MenuGroup[]; prefs: MenuPrefs }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(prefs.order);
  const [hidden, setHidden] = useState(new Set(prefs.hidden));
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  const byId = new Map(groups.map((g) => [g.id, g]));
  const shown = order.map((id) => byId.get(id)).filter((g): g is MenuGroup => !!g);
  const move = (id: string, by: number) => setOrder((o) => { const i = o.indexOf(id), j = i + by; if (i < 0 || j < 0 || j >= o.length) return o; const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const flip = (key: string) => setHidden((h) => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const finish = (fn: () => Promise<{ ok: boolean }>) => start(async () => { setError(""); try { await fn(); setOpen(false); router.refresh(); } catch { setError("Could not save. Try again."); } });
  const reopen = () => { setOrder(prefs.order); setHidden(new Set(prefs.hidden)); setError(""); setOpen(true); };

  return (
    <>
      <button type="button" onClick={reopen} className="mx-2 mb-1 flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[12px] text-sidebar-fg/80 transition hover:bg-white/8 hover:text-white"><Icon name="layers" className="h-3.5 w-3.5" />Arrange menu</button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Arrange menu">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/50 [animation:fade_.2s_ease-out]" />
          <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-surface text-foreground shadow-2xl [animation:pop_.2s_ease-out]">
            <header className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-lg font-semibold">Arrange menu</h2><p className="text-xs text-muted">Move groups, and hide what you do not use. Only your menu changes; hidden pages stay reachable from search.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover"><Icon name="close" /></button></header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{error}</p>}
              {shown.map((g, i) => {
                const off = hidden.has(g.id);
                return (
                  <details key={g.id} className={`rounded-xl border border-border ${off ? "opacity-60" : ""}`}>
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
                      <Icon name={g.icon} className="h-4 w-4 text-muted" /><span className="flex-1 text-sm font-medium">{g.title}</span>
                      <button type="button" aria-label={`Move ${g.title} up`} disabled={i === 0} onClick={(e) => { e.preventDefault(); move(g.id, -1); }} className="rounded p-1 hover:bg-hover disabled:opacity-30">↑</button>
                      <button type="button" aria-label={`Move ${g.title} down`} disabled={i === shown.length - 1} onClick={(e) => { e.preventDefault(); move(g.id, 1); }} className="rounded p-1 hover:bg-hover disabled:opacity-30">↓</button>
                      <label onClick={(e) => e.stopPropagation()} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={!off} onChange={() => flip(g.id)} aria-label={`Show ${g.title}`} />Show</label>
                    </summary>
                    <ul className="space-y-0.5 border-t border-border px-3 py-2">
                      {g.items.map((it) => <li key={it.href}><label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-hover"><input type="checkbox" checked={!hidden.has(it.href)} onChange={() => flip(it.href)} disabled={off} />{it.label}</label></li>)}
                    </ul>
                  </details>
                );
              })}
            </div>
            <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
              <button type="button" onClick={() => finish(resetMenuAction)} disabled={pending} className="text-sm text-muted hover:text-brand hover:underline">Reset to default</button>
              <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</button><button type="button" className="btn" disabled={pending} onClick={() => finish(() => saveMenuAction(order, [...hidden]))}>{pending ? "Saving…" : "Save"}</button></div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
