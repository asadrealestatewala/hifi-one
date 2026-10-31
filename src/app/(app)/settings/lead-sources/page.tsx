import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, ConfirmButton, Empty, PageHeader } from "@/components/ui";
import { NewSourceForm, RotateKey } from "./SourceForms";
import { toggleSourceAction } from "./actions";

export const dynamic = "force-dynamic";

const MODE: Record<string, string> = { ROUND_ROBIN: "taking turns", FIXED: "always the first person", NONE: "nobody (managers are told)" };

export default async function LeadSources() {
  const user = await requirePermission("leadsources.manage");
  const org = user.organizationId;
  const [sources, campaigns, staff, week] = await Promise.all([
    db.leadSource.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" } }),
    db.campaign.findMany({ where: { organizationId: org, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.lead.groupBy({ by: ["leadSourceId"], where: { organizationId: org, leadSourceId: { not: null }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true }),
  ]);
  const names = new Map(campaigns.map((c) => [c.id, c.name]));
  const people = new Map(staff.map((s) => [s.id, s.name]));
  const recent = new Map(week.map((w) => [w.leadSourceId, w._count]));
  return (
    <div className="space-y-5">
      <PageHeader title="Website lead forms" subtitle="Forms on your websites that create leads here, tagged with the campaign and assigned to your sales team." />
      <NewSourceForm campaigns={campaigns} staff={staff} />
      {sources.length === 0 ? <Empty title="No forms yet">Create one above, paste the code into the website, and its leads appear in Leads.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {sources.map((s) => (
            <section key={s.id} className="card space-y-2 text-sm">
              <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{s.name}</h2>{s.active ? <Badge tone="success">on</Badge> : <Badge tone="danger">off</Badge>}</div>
              <p className="text-muted">Campaign: {s.campaignId ? names.get(s.campaignId) ?? "archived" : "none"} · {MODE[s.assignMode]}{s.assigneeIds.length > 0 && `: ${s.assigneeIds.map((i) => people.get(i) ?? "inactive").join(", ")}`}</p>
              <p className="text-muted">Websites: {s.allowedOrigins ?? "any website with the key"}</p>
              <p>{s.leadCount} lead{s.leadCount === 1 ? "" : "s"} in total · {recent.get(s.id) ?? 0} in the last 7 days{s.lastLeadAt && ` · last ${s.lastLeadAt.toLocaleDateString()}`}</p>
              <div className="flex flex-wrap items-start gap-2">
                <Link href={`/leads?source=${s.id}`} className="btn-ghost !py-1 text-xs">See its leads</Link>
                <form action={toggleSourceAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={s.active ? "0" : "1"} />
                  <ConfirmButton className="btn-ghost !py-1 text-xs" title={s.active ? "Turn this form off?" : "Turn this form on?"} message={s.active ? "Submissions are refused until you turn it on again." : "It starts accepting submissions again."} confirmLabel={s.active ? "Turn off" : "Turn on"}>{s.active ? "Turn off" : "Turn on"}</ConfirmButton></form>
                <RotateKey id={s.id} name={s.name} />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
