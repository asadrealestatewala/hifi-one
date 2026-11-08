"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { acknowledgeCircularAction, loadOpenCirculars } from "@/app/(app)/circulars/actions";
import type { CircularCard } from "@/lib/circulars";

const KEY = "circulars-later";
const later = (): string[] => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); } catch { return []; } };

// Pops up an HR circular over whatever the person is doing until they confirm they have read it.
// "Later" hides it for this browser session only; it comes back on the next visit and stays in the bell and on My Space > Circulars.
export default function CircularPopup() {
  const [items, setItems] = useState<CircularCard[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const ok = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => { loadOpenCirculars().then(setItems).catch(() => {}); }, []);
  useEffect(() => {
    setHidden(later());
    refresh();
    const t = setInterval(refresh, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  const shown = items.filter((c) => !hidden.includes(c.id));
  const c = shown[0];
  const snooze = useCallback(() => {
    if (!c) return;
    const next = [...hidden, c.id];
    setHidden(next);
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: it just comes back sooner */ }
  }, [c, hidden]);
  useEffect(() => {
    if (!c) return;
    ok.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") snooze(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [c, snooze]);

  if (!c) return null;
  const confirm = () => start(async () => {
    setError("");
    try { await acknowledgeCircularAction(c.id); setItems((l) => l.filter((x) => x.id !== c.id)); } catch { setError("Could not save that. Check your connection and try again."); }
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center print:hidden">
      <div role="dialog" aria-modal="true" aria-labelledby="circular-title" className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface shadow-lg">
        <div className="space-y-1 border-b border-border px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{c.kind === "URGENT" ? "Urgent circular" : "Circular"}{shown.length > 1 ? ` · 1 of ${shown.length}` : ""}</p>
          <h2 id="circular-title" className="text-lg font-semibold">{c.title}</h2>
          <p className="text-xs text-muted">From {c.from} · {new Date(c.at).toLocaleString()}</p>
        </div>
        <div className="overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm">{c.body}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          {error && <p role="alert" className="mr-auto text-xs text-brand">{error}</p>}
          <button type="button" className="btn-ghost" onClick={snooze}>Later</button>
          <button type="button" ref={ok} className="btn" onClick={confirm} disabled={pending}>{pending ? "Saving…" : "I have read this"}</button>
        </div>
      </div>
    </div>
  );
}
