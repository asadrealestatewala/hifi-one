"use client";

import { useEffect } from "react";

// List shortcuts on every screen (same idea as the action bar in large SaaS products):
//   /      focus the list's search box
//   j / k  move to the next / previous row that opens a record (Enter opens it)
// Ignored while typing in a field, and when a modifier key is held, so browser and Ctrl K shortcuts still work.
export default function KeyboardShortcuts() {
  useEffect(() => {
    const typing = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement)) return;
      if (e.key === "/") {
        const box = document.querySelector<HTMLInputElement>("main [data-list-search]");
        if (box) { e.preventDefault(); box.focus(); box.select(); }
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      const links = Array.from(document.querySelectorAll<HTMLTableRowElement>("main tbody tr"))
        .map((tr) => tr.querySelector<HTMLAnchorElement>("a[href]"))
        .filter((a): a is HTMLAnchorElement => !!a);
      if (links.length === 0) return;
      e.preventDefault();
      const at = links.findIndex((a) => a.closest("tr")?.contains(document.activeElement));
      const next = at === -1 ? (e.key === "j" ? 0 : links.length - 1) : Math.min(links.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)));
      links[next].focus();
      links[next].closest("tr")?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
