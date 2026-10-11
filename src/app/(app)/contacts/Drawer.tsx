"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Icon from "@/components/shell/Icon";

// A panel that slides in from the right over the page, like the reference. Escape or a click outside closes it.
export default function Drawer({ title, closeTo, children }: { title: string; closeTo: string; children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") router.push(closeTo); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [closeTo, router]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close panel" onClick={() => router.push(closeTo)} className="absolute inset-0 bg-black/40 backdrop-blur-[1px] [animation:fade_.2s_ease-out]" />
      <aside className="relative flex h-full w-full max-w-[640px] flex-col bg-background shadow-2xl [animation:slidein_.25s_ease-out]">
        <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={() => router.push(closeTo)} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-foreground"><Icon name="close" /></button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
    </div>
  );
}
