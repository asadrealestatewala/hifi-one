import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { SUPPORT_STATUSES } from "@/lib/support";
import { AppliedFilters, Chips, Empty, PageHeader, Pager, SearchBox, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = { status?: string; who?: string; q?: string; client?: string; page?: string };

export default async function SupportList({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("support.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const q = sp.q?.trim();
  const status = (SUPPORT_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : sp.status === "all" ? "all" : "active";
  const who = sp.who === "me" ? "me" : "all";
  const where = {
    organizationId: org,
    ...(status === "active" ? { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } } : status === "all" ? {} : { status }),
    ...(who === "me" ? { assigneeId: user.id } : {}),
    ...(sp.client ? { clientId: sp.client } : {}),
    ...(q ? { OR: [{ subject: { contains: q, mode: "insensitive" as const } }, { number: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const pg = paging(sp.page);
  const [rows, matched, counts, unassigned, mine] = await Promise.all([
    db.supportRequest.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.supportRequest.count({ where }),
    db.supportRequest.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    db.supportRequest.count({ where: { organizationId: org, assigneeId: null, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.supportRequest.count({ where: { organizationId: org, assigneeId: user.id, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } } }),
  ]);
  const clients = new Map((await db.client.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.clientId))] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const people = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.assigneeId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const count = new Map(counts.map((c) => [c.status as string, c._count]));
  const activeCount = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"].reduce((n, s) => n + (count.get(s) ?? 0), 0);
  const cur: Record<string, string | undefined> = { status: status === "active" ? undefined : status, who: who === "all" ? undefined : who, q, client: sp.client };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/support${t ? `?${t}` : ""}`; };
  const clientName = sp.client ? (await db.client.findFirst({ where: { id: sp.client, organizationId: org }, select: { name: true } }))?.name : null;
  return (
    <div className="space-y-5">
      <PageHeader title="Support requests" subtitle="Questions and problems raised by clients in their portal." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open" value={activeCount} href={href({ status: undefined, who: undefined, page: undefined })} />
        <Stat label="Unassigned" value={unassigned} href={href({ status: "OPEN", who: undefined })} />
        <Stat label="Assigned to me" value={mine} href={href({ who: "me", status: undefined })} />
        <Stat label="Resolved" value={count.get("RESOLVED") ?? 0} href={href({ status: "RESOLVED", who: undefined })} />
      </div>
      <AppliedFilters items={sp.client ? [{ label: `Client: ${clientName ?? "unknown"}`, removeHref: href({ client: undefined }) }] : []} clearHref="/support" />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search subject or number" hidden={{ ...cur, q: undefined }} />
        <Chips current={status} items={[{ key: "active", label: "Open", count: activeCount, href: href({ status: undefined, page: undefined }) }, ...SUPPORT_STATUSES.map((s) => ({ key: s, label: s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), count: count.get(s) ?? 0, href: href({ status: s, page: undefined }) })), { key: "all", label: "All", href: href({ status: "all", page: undefined }) }]} />
        <Chips current={who} items={[{ key: "all", label: "Everyone", href: href({ who: undefined }) }, { key: "me", label: "Mine", href: href({ who: "me" }) }]} />
      </div>
      {rows.length === 0 ? <Empty title="No requests match">Nothing needs attention here.</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Request</th><th className="pr-4">Client</th><th className="pr-4">Priority</th><th className="pr-4">Assigned to</th><th className="pr-4">Updated</th><th className="pr-4">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-2.5"><Link href={`/support/${r.id}`} className="font-medium hover:underline">{r.subject}</Link><span className="block text-xs text-muted">{r.number}</span></td>
                  <td className="pr-4">{clients.get(r.clientId)}</td>
                  <td className="pr-4"><span className={r.priority === "NORMAL" ? "text-muted" : "font-medium text-brand"}>{r.priority.toLowerCase()}</span></td>
                  <td className="pr-4">{r.assigneeId ? people.get(r.assigneeId) : <span className="text-muted">Unassigned</span>}</td>
                  <td className="pr-4 text-muted">{r.updatedAt.toLocaleDateString()}</td>
                  <td className="pr-4"><StatusBadge status={r.status} /></td>
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
