import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { leadScore } from "@/lib/crm";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/leads";
import { formatMoney } from "@/lib/money";
import { Badge, Chips, Empty, NewButton, PageHeader, PanelForm, SearchBox, Stat } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import { createLead } from "./actions";

export const dynamic = "force-dynamic";

export default async function Leads({ searchParams }: { searchParams: Promise<{ error?: string; dup?: string; q?: string; stage?: string; new?: string }> }) {
  const user = await requirePermission("crm.view");
  const { error, dup, q, stage, new: isNew } = await searchParams;
  const canEdit = user.permissions.has("crm.edit");
  const search = q?.trim();
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
  const base = leadScope(user);
  const [leads, campaigns, stages, stageCounts] = await Promise.all([
    db.lead.findMany({
      where: {
        ...base,
        ...(stage ? { stageId: stage } : {}),
        ...(search ? { AND: [{ OR: [{ name: { contains: esc(search), mode: "insensitive" } }, { company: { contains: esc(search), mode: "insensitive" } }, { email: { contains: esc(search), mode: "insensitive" } }, { phone: { contains: search } }] }] } : {}),
      },
      orderBy: { createdAt: "desc" }, take: 200, include: { stage: true },
    }),
    db.campaign.findMany({ where: { organizationId: user.organizationId, status: { in: ["ACTIVE", "PLANNED"] } }, orderBy: { name: "asc" } }),
    db.pipelineStage.findMany({ where: { organizationId: user.organizationId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.lead.groupBy({ by: ["stageId"], where: base, _count: true }),
  ]);
  const counts = new Map(stageCounts.map((c) => [c.stageId, c._count]));
  const total = stageCounts.reduce((n, c) => n + c._count, 0);
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ stage, q: search, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/leads${t ? `?${t}` : ""}`; };
  const dueNow = leads.filter((l) => l.nextFollowUp && l.nextFollowUp < new Date()).length;
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        subtitle={user.permissions.has("crm.view_all") ? "Every lead in the organization." : "Leads assigned to or created by you."}
        actions={<>
          <Link href="/leads/lists" className="btn-ghost">Smart lists</Link>
          <Link href="/pipeline" className="btn-ghost">Board</Link>
          {canEdit && <NewButton href={href({ new: "1" })}>Add lead</NewButton>}
        </>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Leads" value={total} />
        <Stat label="Follow-ups overdue" value={dueNow} hint="in the list below" />
        <Stat label="Stages" value={stages.length} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={search} placeholder="Search name, company, email, phone" hidden={{ stage }} />
        <Chips current={stage ?? "all"} items={[{ key: "all", label: "All", count: total, href: href({ stage: undefined }) }, ...stages.map((st) => ({ key: st.id, label: st.name, count: counts.get(st.id) ?? 0, href: href({ stage: st.id }) }))]} />
      </div>

      {leads.length === 0 ? <Empty title={search ? "No leads match your search" : "No leads yet"}>{canEdit ? "Add your first lead below." : "Leads you own will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Lead</th><th className="pr-4">Stage</th><th className="pr-4">Score</th><th className="pr-4">Campaign</th><th className="pr-4">Value</th><th className="pr-4">Last contact</th><th className="pr-4">Next follow-up</th></tr></thead>
            <tbody>
              {leads.map((l) => {
                const sc = leadScore(l);
                const late = l.nextFollowUp && l.nextFollowUp < new Date();
                return (
                  <tr key={l.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/leads/${l.id}`}>{l.name}</Link><span className="block text-xs text-muted">L-{l.number}{l.company && ` · ${l.company}`}{l.city && ` · ${l.city}`}</span></td>
                    <td className="pr-4"><Badge tone="primary">{l.stage.name}</Badge></td>
                    <td className="pr-4"><Badge tone={sc.score >= 60 ? "success" : sc.score >= 30 ? "warning" : "neutral"}>{sc.score}</Badge></td>
                    <td className="pr-4 text-muted">{l.campaignId ? campaignName.get(l.campaignId) ?? "" : ""}</td>
                    <td className="pr-4">{l.dealValue ? formatMoney(l.dealValue, l.currency) : ""}</td>
                    <td className="pr-4 text-muted">{l.lastContactAt ? l.lastContactAt.toLocaleDateString() : "never"}</td>
                    <td className="pr-4">{l.nextFollowUp ? <span className={late ? "font-medium text-brand" : ""}>{l.nextFollowUp.toLocaleDateString()}</span> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (isNew || error) && (
        <Drawer title="Add a lead" closeTo={href({ new: undefined })}>
          <PanelForm action={createLead} closeTo={href({ new: undefined })} submit="Add lead" error={error} hint="It also appears in Contacts and on the pipeline board.">
            <div className="grid gap-3 sm:grid-cols-2">
              {([["name", "Name", true], ["company", "Company", false], ["email", "Email", false], ["phone", "Phone", false], ["city", "City", false], ["country", "Country", false], ["source", "Source (e.g. Facebook, referral)", false], ["serviceInterest", "Service interest", false], ["dealValue", "Expected deal value", false]] as [string, string, boolean][]).map(([n, label, req]) => (
              <div key={n}><label className="label" htmlFor={n}>{label}</label><input id={n} name={n} required={req} className="input" /></div>
            ))}
            <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="priority">Priority</label><select id="priority" name="priority" className="input" defaultValue="MEDIUM">{["LOW", "MEDIUM", "HIGH"].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="preferredContact">Preferred contact</label><select id="preferredContact" name="preferredContact" className="input" defaultValue=""><option value="">No preference</option>{["CALL", "WHATSAPP", "EMAIL", "SMS"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select></div>
            <div><label className="label" htmlFor="expectedCloseDate">Expected closing date</label><input id="expectedCloseDate" name="expectedCloseDate" type="date" className="input" /></div>
            <div><label className="label" htmlFor="campaignId">Campaign</label><select id="campaignId" name="campaignId" className="input" defaultValue=""><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label" htmlFor="tags">Tags (comma separated)</label><input id="tags" name="tags" className="input" /></div>
            {dup && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="confirmDuplicate" value="1" /> Create anyway, I have checked the existing lead</label>}
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
