import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/shell/Icon";
import { formatMoney } from "@/lib/money";

export const money = (list: { currency: string; amount: string }[]) => (list.length === 0 ? "0" : list.slice(0, 2).map((m) => formatMoney(m.amount, m.currency)).join(" · "));

// A compact number: 1.2M, 424K
export const short = (n: number) => { const a = Math.abs(n); return a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)); };

// One attention card: icon chip, title, a count, a few rows, and a link to the full list.
export function CardPanel({ icon, tone = "primary", title, subtitle, count, href, empty, children }: {
  icon: string; tone?: "primary" | "danger" | "success" | "warning"; title: string; subtitle?: string; count?: number; href: string; empty: string; children?: ReactNode;
}) {
  const chip = { primary: "bg-primary/10 text-primary", danger: "bg-brand/10 text-brand", success: "bg-success/10 text-success", warning: "bg-warning/10 text-warning" }[tone];
  return (
    <section className="card flex h-full min-h-72 flex-col !p-0">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${chip}`}><Icon name={icon} className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{title}</h2>{subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}</div>
        {count !== undefined && <span className={`text-lg font-semibold tabular-nums ${count > 0 && tone === "danger" ? "text-brand" : ""}`}>{count}</span>}
      </header>
      <div className="flex-1 px-4 py-2">{children ?? <p className="py-8 text-center text-sm text-muted">{empty}</p>}</div>
      <Link href={href} className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm text-muted transition hover:text-primary">Open<Icon name="chevron" className="h-4 w-4" /></Link>
    </section>
  );
}

export const Row = ({ href, title, sub, right }: { href: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) => (
  <Link href={href} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0 hover:text-primary"><span className="min-w-0"><span className="block truncate font-medium">{title}</span>{sub && <span className="block truncate text-xs text-muted">{sub}</span>}</span>{right && <span className="shrink-0 tabular-nums">{right}</span>}</Link>
);

// Collected and spent per month, plain SVG so it renders on the server. The scale is per chart, never shared across currencies.
export function FlowChart({ data, currency }: { data: { month: string; collected: number; spent: number }[]; currency: string }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.collected, d.spent]));
  const H = 180, W = 560, pad = 28, band = (W - pad) / data.length, bw = Math.min(22, band / 3);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const label = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label={`Collected and spent per month in ${currency}`} className="w-full">
        {ticks.map((t) => <g key={t}><line x1={pad} x2={W} y1={H - t * H + 4} y2={H - t * H + 4} stroke="var(--border)" strokeDasharray="3 3" /><text x={pad - 4} y={H - t * H + 8} textAnchor="end" fontSize="9" fill="var(--muted)">{short(max * t)}</text></g>)}
        {data.map((d, i) => {
          const x = pad + i * band + band / 2;
          const h1 = (d.collected / max) * H, h2 = (d.spent / max) * H;
          return (
            <g key={d.month}>
              <title>{`${label(d.month)}: collected ${formatMoney(d.collected.toFixed(2), currency)}, spent ${formatMoney(d.spent.toFixed(2), currency)}`}</title>
              <rect x={x - bw - 1} y={H - h1 + 4} width={bw} height={Math.max(h1, d.collected > 0 ? 2 : 0)} rx="3" fill="var(--primary)" />
              <rect x={x + 1} y={H - h2 + 4} width={bw} height={Math.max(h2, d.spent > 0 ? 2 : 0)} rx="3" fill="var(--brand)" opacity="0.8" />
              <text x={x} y={H + 20} textAnchor="middle" fontSize="10" fill="var(--muted)">{label(d.month)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex items-center justify-center gap-4 text-xs text-muted"><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-primary" />Collected (payments received)</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-brand/80" />Spent (expenses in the ledger)</span></figcaption>
    </figure>
  );
}

// Horizontal bars, one per row, scaled to the largest.
export function Bars({ rows, tone = "primary" }: { rows: { label: ReactNode; value: number; note?: ReactNode }[]; tone?: "primary" | "success" | "danger" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const bg = { primary: "bg-primary", success: "bg-success", danger: "bg-brand" }[tone];
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={i} className="text-sm"><div className="mb-1 flex items-center justify-between gap-3"><span className="truncate">{r.label}</span><span className="shrink-0 text-xs text-muted">{r.note ?? r.value}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-hover"><div className={`h-full rounded-full ${bg} transition-all duration-700`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div></li>
      ))}
    </ul>
  );
}
