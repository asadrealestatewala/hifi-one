"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV } from "../_content/site";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

// Header navigation: inline links on wide screens, a disclosure panel on narrow ones (Escape closes it and returns focus).
export function SiteNav() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const links = NAV.map((n) => (
    <li key={n.href}>
      <Link href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}>
        {n.label}
      </Link>
    </li>
  ));

  return (
    <>
      <nav aria-label="Main" className="hs-nav">
        <ul>{links}</ul>
      </nav>
      <div className="hs-header-actions">
        <ThemeToggle />
        <Link href="/portal" className="hs-link-quiet hs-hide-md">Client portal</Link>
        <Link href="/site/contact" className="hs-btn hs-btn-sm hs-hide-sm">Get a quote</Link>
        <button
          ref={button}
          type="button"
          className="hs-menu-btn"
          aria-expanded={open}
          aria-controls="hs-mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name={open ? "close" : "menu"} size={22} />
        </button>
      </div>
      <div id="hs-mobile-menu" className="hs-mobile-menu" hidden={!open}>
        <ul>
          <li><Link href="/site" aria-current={path === "/site" || path === "/" ? "page" : undefined}>Home</Link></li>
          {links}
        </ul>
        <div className="hs-mobile-actions">
          <Link href="/site/contact" className="hs-btn">Get a quote</Link>
          <Link href="/portal" className="hs-btn hs-btn-ghost">Client portal</Link>
          <Link href="/login" className="hs-btn hs-btn-ghost">Staff login</Link>
        </div>
      </div>
    </>
  );
}
