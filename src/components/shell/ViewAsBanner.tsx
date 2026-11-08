"use client";

import { useTransition } from "react";
import Icon from "./Icon";

// Shown on every page while a Super Admin previews a role, with one click back to their own view.
export default function ViewAsBanner({ roleName, stop }: { roleName: string; stop: () => Promise<{ error?: string }> }) {
  const [pending, run] = useTransition();
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-500 px-4 py-2 text-sm font-medium text-black print:hidden">
      <span className="inline-flex items-center gap-2"><Icon name="users" className="h-4 w-4" />Previewing as <strong>{roleName}</strong>. Pages, menus and actions follow this role&apos;s permissions.</span>
      <button type="button" disabled={pending} onClick={() => run(async () => { await stop(); })} className="rounded-md bg-black px-3 py-1 text-xs font-semibold text-white hover:bg-black/80 disabled:opacity-60">
        {pending ? "Switching…" : "Back to Super Admin"}
      </button>
    </div>
  );
}
