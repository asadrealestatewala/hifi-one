"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { MODULE_COLOR } from "./nav-colors";
import { resetMenuAction, saveMenuAction } from "@/app/(app)/menu/actions";
import { MENU_SWATCHES, SIDEBAR_THEMES, moveTo, type MenuGroup, type MenuPrefs } from "@/lib/menu-layout";

// "Customize menu": drag groups into any order (or use the arrows), show or hide groups and single items, pick an icon colour per group
// and a sidebar colour. Applies to this person only and is saved to their account, so it follows them to every device.
export default function ArrangeMenu({ groups, prefs }: { groups: MenuGroup[]; prefs: MenuPrefs }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(prefs.order);
  const [hidden, setHidden] = useState(new Set(prefs.hidden));
  const [colors, setColors] = useState(prefs.colors);
  const [theme, setTheme] = useState(prefs.theme);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const list = useRef<HTMLUListElement>(null);
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
  const move = (id: string, by: number) => setOrder((o) => moveTo(o, id, o.indexOf(id) + by));
  const flip = (key: string) => setHidden((h) => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const paint = (id: string, c: string | null) => setColors((m) => { const n = { ...m }; if (c) n[id] = c; else delete n[id]; return n; });
  const finish = (fn: () => Promise<{ ok: boolean }>) => start(async () => { setError(""); try { await fn(); setOpen(false); router.refresh(); } catch { setError("Your menu was not saved. Check your connection and save again."); } });
  const reopen = () => { setOrder(prefs.order); setHidden(new Set(prefs.hidden)); setColors(prefs.colors); setTheme(prefs.theme); setExpanded(null); setError(""); setOpen(true); };

  // Pointer dragging works with a mouse, a pen and touch. The row under the pointer takes the dragged group's place.
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    for (const [id, el] of rows.current) {
      if (id === dragging) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) { setOrder((o) => moveTo(o, dragging, o.indexOf(id))); break; }
    }
  };
  const t = SIDEBAR_THEMES.find((x) => x.id === theme) ?? SIDEBAR_THEMES[0];

  return (
    <>
      <button type="button" onClick={reopen} className="mx-2 mb-1 flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[12px] text-sidebar-fg/80 transition hover:bg-white/8 hover:text-white"><Icon name="layers" className="h-3.5 w-3.5" />Customize menu</button>
      {/* Rendered on the page body: the sidebar is transformed, which would otherwise trap a fixed dialog inside its narrow column */}
      {open && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Customize menu">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/50 [animation:fade_.2s_ease-out]" />
          <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl bg-surface text-foreground shadow-2xl [animation:pop_.2s_ease-out]">
            <header className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-lg font-semibold">Customize menu</h2><p className="text-xs text-muted">Drag groups into the order you like, pick colours, and hide what you do not use. Only your menu changes, on every device you sign in on.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover"><Icon name="close" /></button></header>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{error}</p>}

              <section aria-labelledby="menu-theme">
                <h3 id="menu-theme" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Sidebar colour</h3>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sidebar colour">
                  {SIDEBAR_THEMES.map((x) => (
                    <button key={x.id} type="button" role="radio" aria-checked={theme === x.id} title={x.label} aria-label={x.label} onClick={() => setTheme(x.id)}
                      className={`h-8 w-8 rounded-lg border-2 transition ${theme === x.id ? "border-primary ring-2 ring-primary/30" : "border-border hover:scale-105"}`}
                      style={{ background: x.bg ?? "var(--sidebar)" }} />
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted">{t.label}</p>
              </section>

              <section aria-labelledby="menu-groups">
                <h3 id="menu-groups" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Groups</h3>
                <ul ref={list} className="space-y-2" onPointerMove={onDragMove} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
                  {shown.map((g, i) => {
                    const off = hidden.has(g.id);
                    const color = colors[g.id] ?? MODULE_COLOR[g.id] ?? "#5648e8";
                    const isOpen = expanded === g.id;
                    return (
                      <li key={g.id} ref={(el) => { if (el) rows.current.set(g.id, el); else rows.current.delete(g.id); }}
                        className={`rounded-xl border bg-surface transition-shadow ${dragging === g.id ? "border-primary shadow-lg ring-2 ring-primary/20" : "border-border"} ${off ? "opacity-60" : ""}`}>
                        <div className="flex items-center gap-2 px-2 py-2">
                          <button type="button" aria-label={`Drag ${g.title}`} title="Drag to move"
                            onPointerDown={(e) => { e.preventDefault(); list.current?.setPointerCapture(e.pointerId); setDragging(g.id); }}
                            className="cursor-grab touch-none rounded p-1.5 text-muted hover:bg-hover active:cursor-grabbing"><Icon name="grip" className="h-4 w-4" /></button>
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: color }}><Icon name={g.icon} className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.title}</span>
                          <button type="button" aria-label={`Move ${g.title} up`} disabled={i === 0} onClick={() => move(g.id, -1)} className="rounded p-1 hover:bg-hover disabled:opacity-30">↑</button>
                          <button type="button" aria-label={`Move ${g.title} down`} disabled={i === shown.length - 1} onClick={() => move(g.id, 1)} className="rounded p-1 hover:bg-hover disabled:opacity-30">↓</button>
                          <button type="button" aria-expanded={isOpen} aria-label={`Colour and pages for ${g.title}`} onClick={() => setExpanded(isOpen ? null : g.id)} className="rounded p-1 text-muted hover:bg-hover"><Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} /></button>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={!off} onChange={() => flip(g.id)} aria-label={`Show ${g.title}`} />Show</label>
                        </div>
                        {isOpen && (
                          <div className="space-y-3 border-t border-border px-3 py-3">
                            <div>
                              <p className="mb-1.5 text-xs font-medium text-muted">Icon colour</p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {MENU_SWATCHES.map((c) => (
                                  <button key={c} type="button" aria-label={`Use ${c}`} aria-pressed={color === c} onClick={() => paint(g.id, c)}
                                    className={`h-6 w-6 rounded-md transition ${color === c ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : "hover:scale-110"}`} style={{ background: c }} />
                                ))}
                                <label className="ml-1 flex items-center gap-1 text-xs text-muted">Custom<input type="color" value={color} onChange={(e) => paint(g.id, e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent" aria-label={`Custom colour for ${g.title}`} /></label>
                                {colors[g.id] && <button type="button" onClick={() => paint(g.id, null)} className="ml-1 text-xs text-muted hover:text-primary hover:underline">Default colour</button>}
                              </div>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-medium text-muted">Pages</p>
                              <ul className="space-y-0.5">
                                {g.items.map((it) => <li key={it.href}><label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-hover"><input type="checkbox" checked={!hidden.has(it.href)} onChange={() => flip(it.href)} disabled={off} />{it.label}</label></li>)}
                              </ul>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs text-muted">Tip: you can also drag groups straight in the sidebar.</p>
              </section>
            </div>
            <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
              <button type="button" onClick={() => finish(resetMenuAction)} disabled={pending} className="text-sm text-muted hover:text-brand hover:underline">Reset to default</button>
              <div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</button><button type="button" className="btn" disabled={pending} onClick={() => finish(() => saveMenuAction({ order, hidden: [...hidden], colors, theme }))}>{pending ? "Saving…" : "Save menu"}</button></div>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
