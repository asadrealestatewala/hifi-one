import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { CLIENT_TYPE_LABEL, currentPeriod, quotaSummary, recurringRevenue } from "@/lib/engagements";
import { Badge, Chips, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const INTERVAL_LABEL: Record<string, string> = { ONE_TIME: "one time", MONTHLY: "per month", QUARTERLY: "per quarter", ANNUAL: "per year" };

export default async function Engagements({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePermission("clients.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const show = sp.show === "recurring" ? "recurring" : sp.show === "one-time" ? "one-time" : sp.show === "all" ? "all" : "active";
  const month = currentPeriod();
  const [revenue, rows] = await Promise.all([
    recurringRevenue(db, org),
    db.engagement.findMany({
      where: { organizationId: org, ...(show === "active" ? { status: "ACTIVE" } : show === "recurring" ? { status: "ACTIVE", interval: { not: "ONE_TIME" } } : show === "one-time" ? { interval: "ONE_TIME" } : {}) },
      orderBy: { createdAt: "desc" }, take: 100, include: { client: { select: { id: true, name: true, clientType: true } } },
    }),
  ]);
  const quotas = new Map(await Promise.all(rows.map(async (e) => [e.id, await quotaSummary(db, org, e.id, month)] as const)));
  const href = (k: string) => (k === "active" ? "/engagements" : `/engagements?show=${k}`);
  return (
    <div className="space-y-5">
      <PageHeader title="Retainers and recurring revenue" subtitle="What clients have bought, how much of it is delivered this month, and the recurring revenue it adds up to. One-time orders are never counted in MRR or ARR." />
      {revenue.length === 0 ? <Empty title="No recurring revenue yet">Start a retainer from a client&apos;s Services tab.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {revenue.flatMap((r) => [
            <Stat key={`${r.currency}-m`} label={`MRR (${r.currency})`} value={formatMoney(r.mrr, r.currency)} hint={`${r.engagements} active recurring`} />,
            <Stat key={`${r.currency}-a`} label={`ARR (${r.currency})`} value={formatMoney(r.arr, r.currency)} />,
          ])}
        </div>
      )}
      <Chips current={show} items={[{ key: "active", label: "Active", href: href("active") }, { key: "recurring", label: "Recurring", href: href("recurring") }, { key: "one-time", label: "One-time", href: href("one-time") }, { key: "all", label: "All", href: href("all") }]} />
      {rows.length === 0 ? <Empty title="Nothing here">No engagements match this filter.</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Client</th><th className="pr-4">Engagement</th><th className="pr-4">Price</th><th className="pr-4">Quota use ({month})</th><th className="pr-4">Status</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const q = quotas.get(e.id) ?? [];
                const used = q.reduce((n, x) => n + Math.min(x.used, x.limit), 0), limit = q.reduce((n, x) => n + x.limit, 0);
                const over = q.some((x) => x.over > 0);
                return (
                  <tr key={e.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-2.5"><Link href={`/clients/${e.client.id}?tab=services`} className="font-medium hover:underline">{e.client.name}</Link><span className="block text-xs text-muted">{CLIENT_TYPE_LABEL[e.client.clientType]}</span></td>
                    <td className="pr-4">{e.name} <Badge tone="neutral">{e.kind === "RETAINER" ? "retainer" : "single"}</Badge></td>
                    <td className="pr-4 whitespace-nowrap">{formatMoney(e.amount, e.currency)} <span className="text-xs text-muted">{INTERVAL_LABEL[e.interval]}</span></td>
                    <td className="pr-4">{limit === 0 ? <span className="text-muted">no quotas</span> : <span className={over ? "font-medium text-danger" : ""}>{used} of {limit} delivered{over ? " (over quota)" : ""}</span>}</td>
                    <td className="pr-4"><StatusBadge status={e.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
