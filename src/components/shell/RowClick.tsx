"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Makes a whole table row open its record: a click anywhere in the row follows the row's first link, unless the click was on a
// control (link, button, field, label) or the person is selecting text. Keyboard and screen-reader users still use the real link.
export default function RowClick() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      if (!target || target.closest("a, button, input, select, textarea, label, summary, [role=button]")) return;
      if (window.getSelection()?.toString()) return;
      const row = target.closest("main tbody tr");
      const a = row?.querySelector<HTMLAnchorElement>("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin) return;
      router.push(u.pathname + u.search);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);
  return null;
}
