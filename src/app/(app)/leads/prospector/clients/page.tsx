import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { STATUS_LABEL, liveForAgent } from "@/lib/solution-feed";
import { Badge, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const NOTE: Record<string, string> = {
  LIVE: "Live. Your commission is earned as the client pays.",
  TRIAL: "On trial. Commission starts with the client's first payment.",
  OVERDUE: "Payment overdue. No new commission until the client pays.",
  SUSPENDED: "Suspended for non-payment. No new commission.",
  CANCELLED: "Cancelled. No new commission.",
};

// A salesperson's own converted clients and how their Solution is doing. Ownership follows the converted lead, as commissions do.
export default async function MyClientsLive() {
  const user = await requirePermission("crm.edit");
  const rows = await liveForAgent(db, user.organizationId, user.id);
  return (
    <div className="space-y-5">
      <PageHeader title="My clients live" subtitle="How the clients you brought in are using their Solution: status and usage counts only. Figures come from the Solution itself." />
      {rows.length === 0 ? (
        <Empty title="No live results yet">When a client you converted is linked to their Solution workspace, their status and usage appear here. Ask the partner team if a client of yours is missing.</Empty>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Client</th><th className="pr-4">Solution</th><th className="pr-4">Status</th><th className="pr-4">Users</th><th className="pr-4">Units</th><th className="pr-4">Paid until</th><th className="pr-4">Commission</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-2.5">{w.name}<div className="text-xs text-muted">{w.lastActivityAt ? `Last activity ${w.lastActivityAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}` : "No activity reported"}{w.stale && " · may be out of date"}</div></td>
                  <td className="pr-4">{w.product}</td>
                  <td className="pr-4 whitespace-nowrap"><Badge tone={w.status === "LIVE" ? "success" : w.status === "OVERDUE" || w.status === "SUSPENDED" ? "warning" : "neutral"}>{STATUS_LABEL[w.status] ?? w.status}</Badge></td>
                  <td className="pr-4">{w.activeUsers ?? "–"}</td>
                  <td className="pr-4 whitespace-nowrap">{w.units != null ? `${w.units}${w.unitLabel ? ` ${w.unitLabel}` : ""}` : "–"}</td>
                  <td className="pr-4 whitespace-nowrap">{w.paidUntil ?? "–"}</td>
                  <td className="pr-4 text-xs text-muted">{NOTE[w.status] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
