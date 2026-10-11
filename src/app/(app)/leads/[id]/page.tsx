import Link from "next/link";
import WhatsAppButton from "@/components/WhatsAppButton";
import { templates } from "@/lib/whatsapp";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/leads";
import { formatMoney } from "@/lib/money";
import { addNote } from "../actions";
import StageSelect from "./StageSelect";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("crm.view");
  const { id } = await params;
  const lead = await db.lead.findFirst({
    where: { id, ...leadScope(user) },
    include: { stage: true, activities: { orderBy: { createdAt: "desc" } } },
  });
  if (!lead) notFound();
  const stages = await db.pipelineStage.findMany({ where: { organizationId: user.organizationId }, orderBy: { sortOrder: "asc" } });
  const canEdit = user.permissions.has("crm.edit");
  const rows: [string, string | null][] = [
    ["Company", lead.company], ["Email", lead.email], ["Phone", lead.phone], ["Country", lead.country],
    ["Source", lead.source], ["Service interest", lead.serviceInterest],
    ["Expected value", lead.dealValue ? formatMoney(lead.dealValue, lead.currency) : null], ["Priority", lead.priority],
  ];
  return (
    <div className="space-y-6">
      <Link href="/leads" className="text-sm text-muted hover:underline">← All leads</Link>
      {lead.phone && canEdit && <WhatsAppButton phone={lead.phone} text={templates.leadFollowUp(lead.name, user.name, "Hifi Marketing and Technologies")} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{lead.name} <span className="text-muted text-base font-normal">L-{lead.number}</span></h1>
        {canEdit && (
          <StageSelect leadId={lead.id} current={lead.stageId} stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold mb-3">Details</h2>
          {lead.clientId && (
            <p className="text-sm mb-3 rounded-lg bg-green-600/10 text-green-700 px-3 py-2">
              Converted to a client. <Link className="underline" href={`/clients/${lead.clientId}`}>Open client account</Link>
            </p>
          )}
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted">Stage</dt><dd className="col-span-2">{lead.stage.name}</dd>
            {rows.map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="col-span-2">{v ?? ""}</dd></div>
            ))}
          </dl>
        </section>
        <section className="card space-y-4">
          <h2 className="font-semibold">Activity</h2>
          {canEdit && (
            <form action={addNote} className="flex gap-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <input name="body" required placeholder="Add a note" className="input" aria-label="Note" />
              <button className="btn">Add</button>
            </form>
          )}
          <ul className="space-y-2 text-sm">
            {lead.activities.map((a) => (
              <li key={a.id} className="border-t border-border pt-2">
                <span className="text-xs text-muted">{a.createdAt.toLocaleString()} · {a.kind}</span>
                <p>{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
