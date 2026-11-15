"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "@/components/shell/Icon";

export type PortalNavItem = { href: string; label: string; icon: string; tone: string; count?: number };

// The client and vendor portals' menu: icon tabs with counts (the same look as the staff app's tabs), scrolling sideways on a phone.
// `exact` marks the portal home, which would otherwise be "active" on every page.
export default function PortalNav({ items, home, label }: { items: PortalNavItem[]; home: string; label: string }) {
  const path = usePathname();
  const isOn = (href: string) => (href === home ? path === home : path === href || path.startsWith(href + "/"));
  return (
    <nav aria-label={label} className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl gap-0.5 overflow-x-auto px-2 sm:px-2">
        {items.map((i) => {
          const on = isOn(i.href);
          return (
            <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
              className={`group relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-2.5 py-3 text-[13px] font-medium transition ${on ? "text-foreground" : "text-muted hover:text-foreground"}`}>
              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, var(--tint-${i.tone}) ${on ? 18 : 12}%, transparent)`, color: `var(--tint-${i.tone})` }}>
                <Icon name={i.icon} className="h-3.5 w-3.5" />
              </span>
              {i.label}
              {!!i.count && <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-5 text-white" aria-label={`${i.count} waiting`}>{i.count}</span>}
              <span aria-hidden className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full ${on ? "bg-primary" : "bg-transparent group-hover:bg-border"}`} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
