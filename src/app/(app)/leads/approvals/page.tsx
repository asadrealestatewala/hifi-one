import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Empty, PageHeader } from "@/components/ui";
import ApprovalRows from "./ApprovalRows";

export const dynamic = "force-dynamic";

export default async function Approvals() {
  const user = await requirePermission("crm.convert");
  const org = user.organizationId;
  const [pending, recent] = await Promise.all([
    db.leadConversionRequest.findMany({ where: { organizationId: org, status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { lead: { select: { id: true, name: true, company: true, number: true, dealValue: true, currency: true, assignedToId: true } } } }),
    db.leadConversionRequest.findMany({ where: { organizationId: org, status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 15, include: { lead: { select: { id: true, name: true, number: true } } } }),
  ]);
  const ids = [...new Set([...pending, ...recent].flatMap((r) => [r.requestedById, r.decidedById].filter(Boolean) as string[]))];
  const names = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Pending approvals" subtitle="Closed Won requests from sales agents. Approving converts the lead into a client and creates a draft invoice when a deal value is set." />
      {pending.length === 0 ? <Empty title="Nothing waiting">When an agent moves a lead to Closed Won, the request shows up here and you get a notification.</Empty> : (
        <ApprovalRows rows={pending.map((r) => ({
          id: r.id, leadId: r.lead.id, lead: `${r.lead.name}${r.lead.company ? ` · ${r.lead.company}` : ""}`, number: r.lead.number,
          value: r.lead.dealValue ? formatMoney(r.lead.dealValue, r.lead.currency) : null, by: names.get(r.requestedById) ?? "Unknown", note: r.note, at: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
        }))} />
      )}
      {recent.length > 0 && (
        <section className="card !p-0 overflow-x-auto">
          <h2 className="px-4 pt-4 font-semibold">Recently decided</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Lead</th><th className="pr-4">Asked by</th><th className="pr-4">Decision</th><th className="pr-4">By</th><th className="pr-4">When</th></tr></thead>
            <tbody>{recent.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2">{r.lead.name} <span className="text-xs text-muted">L-{r.lead.number}</span></td>
                <td className="pr-4">{names.get(r.requestedById) ?? ""}</td>
                <td className="pr-4">{r.status === "APPROVED" ? "Approved" : `Rejected${r.decisionNote ? `: ${r.decisionNote}` : ""}`}</td>
                <td className="pr-4">{r.decidedById ? names.get(r.decidedById) ?? "" : ""}</td>
                <td className="pr-4 text-muted">{r.decidedAt?.toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
