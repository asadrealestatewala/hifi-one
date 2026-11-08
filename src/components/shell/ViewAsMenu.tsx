"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Icon from "./Icon";

type Role = { key: string; name: string };
type Result = { error?: string };

// Super Admin only: pick a role to see the system as that role sees it. The server decides what the preview allows; this is just the switch.
export default function ViewAsMenu({ roles, active, start }: { roles: Role[]; active: string | null; start: (key: string) => Promise<Result> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, run] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", on); document.removeEventListener("keydown", key); };
  }, [open]);
  const pick = (key: string) => run(async () => { const r = await start(key); if (r?.error) setError(r.error); });
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" title="View as another role"
        className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted hover:bg-hover hover:text-foreground">
        <Icon name="users" className="h-4 w-4" /><span className="hidden lg:inline">View as</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          <p className="px-3 py-2 text-xs text-muted">See the system exactly as this role sees it. Nothing about your own account changes.</p>
          {roles.map((r) => (
            <button key={r.key} type="button" role="menuitem" disabled={pending} onClick={() => pick(r.key)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-60">
              {r.name}{active === r.key && <Icon name="check" className="h-4 w-4 text-primary" />}
            </button>
          ))}
          {error && <p role="alert" className="px-3 py-2 text-xs text-brand">{error}</p>}
        </div>
      )}
    </div>
  );
}
