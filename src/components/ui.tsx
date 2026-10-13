// Small building blocks so every screen looks and behaves the same.
import type { ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/shell/Icon";
import SubmitButton from "./ui/SubmitButton";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  neutral: "bg-hover text-muted",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-brand/10 text-brand",
} as const;
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Progress({ value, max, label }: { value: number; max: number | null; label?: string }) {
  if (!max) return <span className="text-xs text-muted">{value}</span>;
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="min-w-24" title={label ?? `${value} of ${max}`}>
      <div className="mb-1 flex justify-between text-[11px]"><span className="font-medium">{value}</span><span className="text-muted">/ {max}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// A KPI card. With `href` the whole card is a link to the filtered list behind the number (keyboard reachable,
// with a visible arrow so it reads as clickable).
export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="flex items-center justify-between text-xs font-medium text-muted">{label}{href && <Icon name="chevron" className="h-3.5 w-3.5 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </>
  );
  return href
    ? <Link href={href} className="group card block !p-4 transition hover:border-primary/40 hover:shadow-md" aria-label={`${label}: open the list`}>{body}</Link>
    : <div className="card !p-4">{body}</div>;
}

// Shows the filters applied to a report, each removable, and a way back to where the person came from.
export function AppliedFilters({ items, clearHref, backHref, backLabel = "Back to dashboard" }: { items: { label: string; removeHref: string }[]; clearHref: string; backHref?: string; backLabel?: string }) {
  if (items.length === 0 && !backHref) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Applied filters">
      {backHref && <Link href={backHref} className="btn-ghost !py-1">← {backLabel}</Link>}
      {items.length > 0 && <span className="text-muted">Filtered by</span>}
      {items.map((i) => (
        <Link key={i.label} href={i.removeHref} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[13px] text-primary hover:bg-primary/15" aria-label={`Remove filter ${i.label}`}>{i.label} <span aria-hidden>×</span></Link>
      ))}
      {items.length > 1 && <Link href={clearHref} className="text-xs text-muted underline">Clear all</Link>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-1 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  return kind === "error"
    ? <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{children}</p>
    : <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{children}</p>;
}

// ---------- shared list-screen pieces ----------
const STATUS_TONE: Record<string, keyof typeof TONES> = {
  ACTIVE: "success", PAID: "success", APPROVED: "success", ACCEPTED: "success", COMPLETED: "success", POSTED: "success", LIVE: "success", CUSTOMER: "success", WON: "success", ISSUED: "primary", SENT: "primary", SCHEDULED: "primary", PARTIALLY_PAID: "warning",
  DRAFT: "neutral", PENDING: "warning", ON_HOLD: "warning", SUBMITTED: "warning", UNDER_REVIEW: "warning", OVERDUE: "danger", CANCELLED: "danger", REJECTED: "danger", DECLINED: "danger", ENDED: "neutral", TERMINATED: "danger", EXPIRED: "neutral", CREDITED: "neutral", INVOICED: "success", INACTIVE: "warning", ARCHIVED: "neutral", EXITED: "neutral",
};
export const statusTone = (s: string): keyof typeof TONES => STATUS_TONE[s.toUpperCase().replace(/ /g, "_")] ?? "neutral";
export function StatusBadge({ status }: { status: string }) { return <Badge tone={statusTone(status)}>{status.toLowerCase().replace(/_/g, " ")}</Badge>; }

// A row of filter chips with counts, each one a link, so the filter lives in the address and can be shared or bookmarked.
export function Chips({ items, current }: { items: { key: string; label: string; count?: number; href: string }[]; current: string }) {
  return (
    <nav aria-label="Filter" className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={current === i.key ? "page" : undefined}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition ${current === i.key ? "border-primary bg-primary text-white" : "border-border bg-surface text-muted hover:border-primary/40 hover:text-foreground"}`}>
          {i.label}{i.count !== undefined && <span className={`rounded-full px-1.5 text-[11px] ${current === i.key ? "bg-white/20" : "bg-hover"}`}>{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function SearchBox({ q, placeholder, hidden }: { q?: string; placeholder: string; hidden?: Record<string, string | undefined> }) {
  return (
    <form role="search" className="relative min-w-60 flex-1 sm:max-w-sm">
      {Object.entries(hidden ?? {}).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} className="input !pl-9" />
    </form>
  );
}

export function NewButton({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="btn"><Icon name="plus" className="h-4 w-4" />{children}</Link>;
}

// Footer for a paged list: "51–100 of 230" with previous and next links. `href(n)` builds the address of page n
// keeping the current filters, so pages can be shared.
export function Pager({ page, size, total, href }: { page: number; size: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : Math.min((page - 1) * size + 1, total);
  const to = Math.min(page * size, total);
  const link = "rounded-lg border border-border bg-surface px-3 py-1 text-[13px] font-medium hover:bg-hover";
  const off = "rounded-lg border border-border px-3 py-1 text-[13px] text-muted opacity-50";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm text-muted">
      <span>{total === 0 ? "No results" : `${from}–${to} of ${total}`}</span>
      {pages > 1 && (
        <span className="flex items-center gap-2">
          {page > 1 ? <Link className={link} href={href(page - 1)} rel="prev">Previous</Link> : <span className={off} aria-disabled="true">Previous</span>}
          <span>Page {Math.min(page, pages)} of {pages}</span>
          {page < pages ? <Link className={link} href={href(page + 1)} rel="next">Next</Link> : <span className={off} aria-disabled="true">Next</span>}
        </span>
      )}
    </nav>
  );
}

// From/to date filter for a list. Keeps the other filters as hidden fields; the range lives in the address.
export function DateRangeForm({ from, to, hidden, label = "Dates" }: { from?: string; to?: string; hidden?: Record<string, string | undefined>; label?: string }) {
  return (
    <form className="flex flex-wrap items-center gap-2" aria-label={`${label} filter`}>
      {Object.entries(hidden ?? {}).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <span className="text-xs text-muted">{label}</span>
      <input type="date" name="from" defaultValue={from} aria-label={`${label} from`} className="input !w-auto" />
      <span className="text-xs text-muted">to</span>
      <input type="date" name="to" defaultValue={to} aria-label={`${label} to`} className="input !w-auto" />
      <button className="btn-ghost">Apply</button>
    </form>
  );
}

// Escapes % and _ so typed text is matched literally in LIKE searches
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

export { default as Avatar } from "./ui/Avatar";
export { default as SubmitButton } from "./ui/SubmitButton";
export { default as ConfirmButton } from "./ui/ConfirmButton";

// Body of a slide-over "New …" panel: scrolling fields with a fixed Save / Cancel bar.
export function PanelForm({ action, closeTo, submit, error, hint, children }: { action: (f: FormData) => void | Promise<void>; closeTo: string; submit: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <form action={action} className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {error && <Notice kind="error">{error}</Notice>}
        {children}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3">
        <p className="text-xs text-muted">{hint}</p>
        <div className="flex gap-2"><Link href={closeTo} className="btn-ghost">Cancel</Link><SubmitButton>{submit}</SubmitButton></div>
      </footer>
    </form>
  );
}
