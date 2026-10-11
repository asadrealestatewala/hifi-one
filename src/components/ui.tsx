// Small building blocks so every screen looks and behaves the same.
import type { ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/shell/Icon";

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

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card !p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
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
  DRAFT: "neutral", PENDING: "warning", ON_HOLD: "warning", SUBMITTED: "warning", UNDER_REVIEW: "warning", OVERDUE: "danger", CANCELLED: "danger", REJECTED: "danger", DECLINED: "danger", ENDED: "neutral", TERMINATED: "danger", EXPIRED: "neutral", CREDITED: "neutral", INVOICED: "success",
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

// Escapes % and _ so typed text is matched literally in LIKE searches
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

const AVATAR_HUES = ["#5648e8", "#8b5cf6", "#2563eb", "#f97316", "#059669", "#e11d74", "#d97706", "#0d9488"];
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38, background: AVATAR_HUES[h % AVATAR_HUES.length] }}>{initials}</span>;
}

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
        <div className="flex gap-2"><Link href={closeTo} className="btn-ghost">Cancel</Link><button className="btn">{submit}</button></div>
      </footer>
    </form>
  );
}
