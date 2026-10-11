"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import Icon from "@/components/shell/Icon";
import { resetDashboardLayoutAction, saveDashboardLayoutAction } from "./actions";

export type GridWidget = { id: string; title: string; wide: boolean; node: ReactNode | null };

// The dashboard. "Customise" lets you drag widgets (or use the arrows), hide the ones you do not need and bring them back; Done saves it for you only.
export default function DashboardGrid({ widgets, order: o, hidden: h }: { widgets: GridWidget[]; order: string[]; hidden: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(o);
  const [hidden, setHidden] = useState(new Set(h));
  const [drag, setDrag] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const move = (id: string, to: number) => setOrder((cur) => { const a = cur.filter((x) => x !== id); a.splice(Math.max(0, Math.min(a.length, to)), 0, id); return a; });
  const save = () => start(async () => {
    setErr("");
    try { await saveDashboardLayoutAction(order, [...hidden]); setEditing(false); router.refresh(); } catch { setErr("Could not save your layout. Try again."); }
  });
  const reset = () => start(async () => { try { await resetDashboardLayoutAction(); setEditing(false); router.refresh(); } catch { setErr("Could not reset."); } });
  const shown = order.filter((id) => byId.has(id) && (editing || !hidden.has(id)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {err && <span role="alert" className="text-sm text-brand">{err}</span>}
        {editing ? (
          <>
            <button type="button" className="btn-ghost" onClick={reset} disabled={pending}>Reset to default</button>
            <button type="button" className="btn-ghost" onClick={() => { setOrder(o); setHidden(new Set(h)); setEditing(false); }} disabled={pending}>Cancel</button>
            <button type="button" className="btn" onClick={save} disabled={pending}>{pending ? "Saving…" : "Done"}</button>
          </>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}><Icon name="layers" className="h-4 w-4" />Customise</button>
        )}
      </div>
      {editing && <p className="rounded-xl bg-hover px-3 py-2 text-sm text-muted">Drag a widget by its handle, or use the arrows, to reorder. Use the eye to hide or show. Only you see this layout.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {shown.map((id, idx) => {
          const w = byId.get(id)!;
          const off = hidden.has(id);
          return (
            <section key={id} className={`${w.wide ? "lg:col-span-2" : ""} ${editing ? "rounded-2xl ring-1 ring-dashed ring-primary/40" : ""} ${drag === id ? "opacity-40" : ""} ${off ? "opacity-50" : ""}`}
              draggable={editing} onDragStart={() => setDrag(id)} onDragEnd={() => setDrag(null)}
              onDragOver={(e) => { if (editing && drag && drag !== id) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (drag && drag !== id) move(drag, order.indexOf(id)); setDrag(null); }}>
              {editing && (
                <div className="flex items-center justify-between gap-2 rounded-t-2xl bg-hover px-3 py-1.5 text-sm">
                  <span className="flex cursor-grab items-center gap-2 font-medium" title="Drag to reorder"><Icon name="layers" className="h-4 w-4 text-muted" />{w.title}</span>
                  <span className="flex items-center gap-1">
                    <button type="button" aria-label={`Move ${w.title} up`} disabled={idx === 0} onClick={() => move(id, order.indexOf(id) - 1)} className="rounded p-1 hover:bg-surface disabled:opacity-30">↑</button>
                    <button type="button" aria-label={`Move ${w.title} down`} disabled={idx === shown.length - 1} onClick={() => move(id, order.indexOf(id) + 1)} className="rounded p-1 hover:bg-surface disabled:opacity-30">↓</button>
                    <button type="button" aria-pressed={!off} aria-label={`${off ? "Show" : "Hide"} ${w.title}`} onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} className="rounded px-2 py-0.5 text-xs hover:bg-surface">{off ? "Hidden · show" : "Shown · hide"}</button>
                  </span>
                </div>
              )}
              {w.node ?? (editing ? <div className="card text-sm text-muted">This widget will appear after you press Done.</div> : null)}
            </section>
          );
        })}
      </div>
      {!editing && shown.length === 0 && <div className="card text-sm text-muted">Every widget is hidden. Press Customise to bring some back.</div>}
    </div>
  );
}
