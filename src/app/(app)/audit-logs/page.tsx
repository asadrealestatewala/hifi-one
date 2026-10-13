import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { Empty, PageHeader, Pager, SearchBox } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditLogs({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requirePermission("audit.view");
  const sp = await searchParams;
  const q = sp.q?.trim();
  const pg = paging(sp.page);
  const where = {
    organizationId: user.organizationId,
    ...(q ? { OR: [{ action: { contains: q, mode: "insensitive" as const } }, { entity: { contains: q, mode: "insensitive" as const } }, { actor: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const [logs, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take, include: { actor: { select: { name: true } } } }),
    db.auditLog.count({ where }),
  ]);
  const href = (n: number) => { const p = new URLSearchParams(); if (q) p.set("q", q); if (n > 1) p.set("page", String(n)); const t = p.toString(); return `/audit-logs${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Audit Logs" subtitle="Who changed what, newest first." />
      <SearchBox q={q} placeholder="Search action, record or person" />
      {logs.length === 0 ? <Empty title={q ? "No events match" : "No events yet"} /> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted">
              <tr><th className="px-4 py-2.5">When</th><th className="pr-4">Who</th><th className="pr-4">Action</th><th className="pr-4">Record</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="whitespace-nowrap px-4 py-2.5">{l.createdAt.toLocaleString()}</td>
                  <td className="pr-4">{l.actor?.name ?? "System"}</td>
                  <td className="pr-4 font-mono text-xs">{l.action}</td>
                  <td className="pr-4 text-xs text-muted">{l.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={total} href={href} />
        </div>
      )}
    </div>
  );
}
