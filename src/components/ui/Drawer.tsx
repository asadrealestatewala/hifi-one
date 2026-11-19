"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Icon from "@/components/shell/Icon";
import { navStarted } from "@/components/shell/NavProgress";

const CloseContext = createContext<(() => void) | null>(null);

// Cancel inside a panel: closes it the same way as the close button. Outside a Drawer it is a plain link.
export function DrawerCancel({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const close = useContext(CloseContext);
  return <Link href={href} className={className} onClick={(e) => { if (!close || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); close(); }}>{children}</Link>;
}

// A panel that slides in from the right over the page, like the reference. The close button, Escape or a click outside closes it.
// Closing hides the panel at once and then moves to `closeTo`; if the in-app navigation has not happened within a moment (a slow
// server, or a page loaded before a new version went live), it falls back to a full page load, so the panel never seems stuck.
export default function Drawer({ title, closeTo, children }: { title: string; closeTo: string; children: React.ReactNode }) {
  const router = useRouter();
  const [closed, setClosed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => {
    setClosed(true);
    document.body.style.overflow = "";
    const from = window.location.href;
    navStarted(closeTo);
    router.push(closeTo);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (window.location.href === from) window.location.assign(closeTo); }, 2500);
  }, [closeTo, router]);
  useEffect(() => {
    if (closed) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [close, closed]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (closed) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close panel" onClick={close} className="absolute inset-0 bg-black/40 backdrop-blur-[1px] [animation:fade_.2s_ease-out]" />
      <aside className="relative flex h-full w-full max-w-[640px] flex-col bg-background shadow-2xl [animation:slidein_.25s_ease-out]">
        <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-foreground"><Icon name="close" /></button>
        </header>
        <div className="min-h-0 flex-1"><CloseContext.Provider value={close}>{children}</CloseContext.Provider></div>
      </aside>
    </div>
  );
}
