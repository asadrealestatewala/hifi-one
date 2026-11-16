import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { expireQuotes } from "@/lib/sales";
import { Chips, Empty, ExportLink, NewButton, Notice, PageHeader, Pager, SearchBox, Stat, StatusBadge, ListToolbar } from "@/components/ui";
import { listHref } from "@/lib/list-params";
import { QUOTE_STATUSES, quoteParams, quoteWhere } from "@/lib/lists";

export const dynamic = "force-dynamic";

type SP = { error?: string; status?: string; q?: string; new?: string; page?: string; client?: string };

export default async function Quotes({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("quotes.view");
  const sp = await searchParams;
  // The editor is a full page now; old "?new=1" links still work
  if (sp.new) redirect(`/quotes/new${sp.client ? `?client=${encodeURIComponent(sp.client)}` : ""}`);
  const org = user.organizationId;
  await expireQuotes(db, org, new Date().toISOString().slice(0, 10));
  const canManage = user.permissions.has("quotes.manage");
  // Counts and the pipeline value come from aggregates over every quote; only the shown page is loaded
  const [counts, sentValue] = await Promise.all([
    db.quote.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    db.quote.groupBy({ by: ["currency"], where: { organizationId: org, status: "SENT" }, _sum: { total: true } }),
  ]);
  const byStatus = new Map(counts.map((c) => [c.status as string, c._count]));
  const statuses = [...byStatus.keys()];
  const status = sp.status && QUOTE_STATUSES.includes(sp.status as never) ? sp.status : "all";
  const lp = quoteParams(sp);
  const q = lp.q;
  const where = quoteWhere(user, lp);
  const pg = lp.page;
  const [quotes, matched] = await Promise.all([
    db.quote.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take, include: { client: true } }),
    db.quote.count({ where }),
  ]);
  const count = (s: string) => byStatus.get(s) ?? 0;
  const all = counts.reduce((n, c) => n + c._count, 0);
  const pipeline = new Map(sentValue.filter((r) => r._sum.total).map((r) => [r.currency, r._sum.total!]));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status: status === "all" ? undefined : status, q: sp.q?.trim(), ...over })) if (v) p.set(k, v); const t = p.toString(); return `/quotes${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Proposals & quotations" subtitle="Write the proposal, price the work, send it, and turn accepted ones into invoices." actions={<><ExportLink href={listHref("/quotes/export", { status: lp.status, q })} />{canManage && <NewButton href="/quotes/new">New proposal or quotation</NewButton>}</>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Drafts" value={count("DRAFT")} />
        <Stat label="Sent, awaiting answer" value={count("SENT")} hint={pipeline.size ? [...pipeline].map(([c, v]) => formatMoney(v, c)).join(" · ") : undefined} />
        <Stat label="Accepted" value={count("ACCEPTED")} />
        <Stat label="Expired or declined" value={count("EXPIRED") + count("DECLINED")} />
      </div>
      {sp.error && !sp.new && <Notice kind="error">{sp.error}</Notice>}
      <ListToolbar>
        <SearchBox q={sp.q?.trim()} placeholder="Search number or client" hidden={{ status: status === "all" ? undefined : status }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: all, href: href({ status: undefined }) }, ...statuses.map((s) => ({ key: s, label: s.toLowerCase().replace(/^./, (c) => c.toUpperCase()), count: count(s), href: href({ status: s }) }))]} />
      </ListToolbar>
      {quotes.length === 0 ? <Empty title={q || status !== "all" ? "No quotations match" : "No quotations yet"}>{canManage ? "Create one with New proposal or quotation." : "Proposals and quotations will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Number</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4">Valid until</th><th className="pr-4 text-right">Total</th></tr></thead>
            <tbody>
              {quotes.map((x) => (
                <tr key={x.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/quotes/${x.id}`}>{x.number}</Link>{(x.introduction || x.scope || x.timeline) && <span className="ml-2 rounded-full bg-hover px-2 py-0.5 text-xs text-muted">Proposal</span>}{x.title && <div className="max-w-xs truncate text-xs text-muted">{x.title}</div>}</td>
                  <td className="pr-4">{x.client.name}</td><td className="pr-4"><StatusBadge status={x.status} /></td><td className="pr-4 text-muted">{x.validUntil ?? ""}</td>
                  <td className="pr-4 text-right tabular-nums">{formatMoney(x.total, x.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
        </div>
      )}
    </div>
  );
}
