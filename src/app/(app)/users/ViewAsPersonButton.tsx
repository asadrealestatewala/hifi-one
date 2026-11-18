"use client";

import { useState, useTransition } from "react";

// Super Admin only. Opens one person's own view, read-only; the server checks again and refuses anyone else.
export default function ViewAsPersonButton({ userId, name, start }: { userId: string; name: string; start: (id: string, tell: boolean) => Promise<{ error?: string }> }) {
  const [tell, setTell] = useState(false);
  const [error, setError] = useState("");
  const [pending, run] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-1 text-xs text-muted">
        <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} />Tell them
      </label>
      <button type="button" disabled={pending} aria-label={`View as ${name}`} onClick={() => run(async () => { const r = await start(userId, tell); if (r?.error) setError(r.error); })}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-hover disabled:opacity-60">{pending ? "Opening…" : "View as"}</button>
      {error && <span role="alert" className="text-xs text-brand">{error}</span>}
    </span>
  );
}
