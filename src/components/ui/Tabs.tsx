import Link from "next/link";
import Icon from "@/components/shell/Icon";
import type { IconName } from "@/components/shell/Icon";

// Screens on one subject, as an underlined tab bar with a coloured icon and an optional count.
// Same props as `Chips` (each tab is a link, the state lives in the address). Use `Chips` for filters, `Tabs` for screens.
// The icon and colour come from the label (see GUESS), so existing tab lists get icons without edits; pass `icon` or `tone` to override.
import { guess, type Tone } from "@/lib/tint";

type Item = { key: string; label: string; count?: number; href: string; icon?: IconName; tone?: Tone };

export default function Tabs({ items, current, label = "Sections" }: { items: Item[]; current: string; label?: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-border">
      {items.map((i) => {
        const [gi, gt] = guess(i.label);
        const on = current === i.key;
        const tone = i.tone ?? gt;
        return (
          <Link key={i.key} href={i.href} aria-current={on ? "page" : undefined}
            className={`group relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition ${on ? "text-foreground" : "text-muted hover:text-foreground"}`}>
            <span className="grid h-6 w-6 place-items-center rounded-lg transition group-hover:scale-105"
              style={{ background: `color-mix(in srgb, var(--tint-${tone}) ${on ? 18 : 12}%, transparent)`, color: `var(--tint-${tone})` }}>
              <Icon name={i.icon ?? gi} className="h-3.5 w-3.5" />
            </span>
            {i.label}
            {i.count !== undefined && <span className={`rounded-full px-1.5 text-[11px] ${on ? "bg-primary/10 text-primary" : "bg-hover"}`}>{i.count}</span>}
            <span className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full transition ${on ? "bg-primary" : "bg-transparent group-hover:bg-border"}`} />
          </Link>
        );
      })}
    </nav>
  );
}
