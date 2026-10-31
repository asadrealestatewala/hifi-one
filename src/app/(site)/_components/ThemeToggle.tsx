"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

// Light/dark switch. Shares the ERP's setting ("hifi.theme" on <html data-theme>), which the root layout applies before
// the first paint, so the chosen theme never flashes and carries over between the website and the ERP.
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);

  function toggle() {
    const next = !(document.documentElement.dataset.theme === "dark");
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("hifi.theme", next ? "dark" : "light");
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    setDark(next);
  }

  return (
    <button type="button" className="hs-icon-btn" onClick={toggle} aria-label="Dark mode" aria-pressed={dark ?? undefined} title={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}
