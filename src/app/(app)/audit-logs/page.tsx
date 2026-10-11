import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AuditLogs() {
  const user = await requirePermission("audit.view");
  const logs = await db.auditLog.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { name: true } } },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
      <p className="text-sm text-muted">Latest 100 events.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-hover/60 text-left text-xs text-muted">
            <tr>
              <th className="py-2 pr-4">When</th>
              <th className="pr-4">Who</th>
              <th className="pr-4">Action</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-border transition hover:bg-hover/50">
                <td className="py-2 pr-4 whitespace-nowrap">{l.createdAt.toLocaleString()}</td>
                <td className="pr-4">{l.actor?.name ?? "System"}</td>
                <td className="pr-4 font-mono text-xs">{l.action}</td>
                <td className="text-xs text-muted">{l.entity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
