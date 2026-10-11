"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";

type Group = { id: string; title: string; icon: string; items: { href: string; label: string }[] };

// One accent colour per module, used for the icon chip on each tab and the sidebar highlight.
const COLOR: Record<string, string> = {
  overview: "#5648e8", crm: "#8b5cf6", clients: "#2563eb", projects: "#f97316", finance: "#059669", people: "#e11d74", vendors: "#d97706", me: "#0d9488", admin: "#475569",
};

const ICON: Record<string, string> = {
  "/dashboard": "home", "/search": "search", "/contacts": "users", "/leads": "target", "/pipeline": "layers", "/leads/lists": "sparkles", "/leads/worklists": "file", "/campaigns": "target", "/sales/activity": "activity", "/quotes": "receipt",
  "/services": "layers", "/clients": "building", "/contracts": "file", "/finance/subscriptions": "clock", "/finance/invoices": "receipt", "/finance/payments": "wallet",
  "/projects": "briefcase", "/content": "calendar", "/meetings": "video",
  "/finance/ledger": "folder", "/finance/accounts": "layers", "/finance/journals": "file", "/finance/reconciliation": "check", "/finance/budgets": "chart", "/finance/commissions": "wallet", "/finance/reports": "chart", "/finance/close": "shield", "/finance/year-end": "calendar", "/assets": "building", "/investments": "chart",
  "/hr/employees": "users", "/hr/attendance": "clock", "/payroll": "wallet", "/hr/monitoring": "activity",
  "/vendors": "truck", "/procurement": "file",
  "/me/attendance": "clock", "/me/time": "activity", "/me/leave": "calendar", "/me/payslips": "receipt", "/expenses": "wallet", "/me/commissions": "wallet", "/me/documents": "folder", "/me/calendar": "calendar", "/assistant": "sparkles",
  "/users": "users", "/roles": "key", "/settings/company": "building", "/settings/organization": "building", "/settings/bank-accounts": "wallet", "/settings/documents": "file", "/settings/exchange-rates": "chart", "/settings/tax-rates": "receipt", "/settings/email": "mail", "/settings/monitoring": "shield", "/audit-logs": "file", "/settings/security": "shield",
};

// The tab strip at the top of every module: the screens of the module you are in, as pills with coloured icons.
export default function ModuleTabs({ groups }: { groups: Group[] }) {
  const pathname = usePathname();
  const all = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g })));
  const here = all.filter((i) => pathname === i.href || pathname.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
  if (!here || here.group.items.length < 2) return null;
  const g = here.group;
  const color = COLOR[g.id] ?? "#5648e8";
  return (
    <nav aria-label={`${g.title} sections`} className="-mx-4 mb-6 overflow-x-auto px-4 md:-mx-8 md:px-8 [scrollbar-width:none]">
      <ul className="flex w-max min-w-full items-center gap-1.5 rounded-2xl border border-border bg-surface p-1.5 shadow-sm">
        {g.items.map((i) => {
          const on = here.href === i.href;
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-[13px] transition ${on ? "bg-hover font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted hover:bg-hover hover:text-foreground"}`}>
                <span className="flex h-6 w-6 items-center justify-center rounded-lg text-white" style={{ background: on ? color : `color-mix(in srgb, ${color} 55%, var(--muted))`, opacity: on ? 1 : 0.85 }}>
                  <Icon name={ICON[i.href] ?? g.icon} className="h-3.5 w-3.5" />
                </span>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
