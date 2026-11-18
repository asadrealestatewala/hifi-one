"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Tabs from "@/components/ui/Tabs";
import { resolveTab } from "./tabs";

// The project page's sections as tabs. Every panel is rendered on the server (each keeps its own permission checks);
// this only shows one at a time. Links inside the page switch tabs by #hash (#tasks, #files…); forms come back with
// ?tab=… (see tabs.ts), which the page passes in as `initial`.
export type ProjectTab = { key: string; label: string; count?: number; panel: ReactNode };

export default function ProjectTabs({ header, tabs, initial }: { header: ReactNode; tabs: ProjectTab[]; initial: string }) {
  const keys = tabs.map((t) => t.key);
  const [current, setCurrent] = useState(keys.includes(initial) ? initial : keys[0]);

  // A form that comes back with ?tab=… re-renders this page without remounting it, so follow the new `initial`.
  useEffect(() => {
    if (keys.includes(initial)) setCurrent(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    const sync = () => { const k = resolveTab(window.location.hash, keys); if (k) setCurrent(k); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
    // keys only change when the person's permissions change, which reloads the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(",")]);

  // Any same-page "#tab" link (the tab row, header buttons, key figures) switches tab without a page load.
  const onClickCapture = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!href || !href.startsWith("#")) return;
    const k = resolveTab(href, keys);
    if (!k) return;
    e.preventDefault();
    setCurrent(k);
    const q = new URLSearchParams(window.location.search); q.delete("tab");
    history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}#${href.slice(1)}`);
    if (href.slice(1) !== k) document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-5" onClickCapture={onClickCapture}>
      {header}
      <Tabs label="Project sections" current={current} items={tabs.map((t) => ({ key: t.key, label: t.label, count: t.count, href: `#${t.key}` }))} />
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" aria-label={t.label} hidden={t.key !== current}>{t.panel}</div>
      ))}
    </div>
  );
}
