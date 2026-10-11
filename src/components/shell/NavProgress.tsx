"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// A thin bar across the top that starts the moment you click an in-app link and finishes when the new page arrives,
// so a click never feels like it did nothing.
export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search)) return;
      stop(); setPct(8);
      timer.current = setInterval(() => setPct((p) => (p < 90 ? p + (90 - p) * 0.12 : p)), 120);
    };
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("click", onClick, true); stop(); };
  }, []);

  useEffect(() => {
    stop(); setPct((p) => (p > 0 ? 100 : 0));
    const t = setTimeout(() => setPct(0), 250);
    return () => clearTimeout(t);
  }, [pathname, search]);

  return <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"><div className="h-full bg-gradient-to-r from-primary to-accent shadow-[0_0_8px_var(--accent)]" style={{ width: `${pct}%`, opacity: pct === 0 ? 0 : 1, transition: pct === 0 ? "opacity .2s" : "width .2s ease-out" }} /></div>;
}
