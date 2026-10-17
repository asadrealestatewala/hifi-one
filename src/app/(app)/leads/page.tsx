import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { leadScore } from "@/lib/crm";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/leads";
import { formatMoney } from "@/lib/money";
import { parseRange, rangeFilter, rangeLabel } from "@/lib/date-range";
import { AppliedFilters, Badge, DateRangeForm, Chips, Empty, NewButton, PageHeader, Pager, PanelForm, SearchBox, SortTh, Stat } from "@/components/ui";
import { paging } from "@/lib/paging";
import { orderFor, parseSort } from "@/lib/sort";
import Drawer from "@/components/ui/Drawer";
import { createLead } from "./actions";

export const dynamic = "force-dynamic";
const SORTS = { name: { field: "name" }, value: { field: "dealValue", nullable: true }, followup: { field: "nextFollowUp", nullable: true }, created: { field: "createdAt" } };

export default async function Leads({ searchParams }: { searchParams: Promise<{ error?: string; dup?: string; q?: string; stage?: string; new?: string; page?: string; campaign?: string; source?: string; from?: string; to?: string; src?: string; sort?: string; dir?: string }> }) {
  const user = await requirePermission("crm.view");
  const { error, dup, q, stage, new: isNew, page, campaign, source, from, to, src, sort: sortRaw, dir: dirRaw } = await searchParams;
  const sort = parseSort(sortRaw, dirRaw, Object.keys(SORTS), { key: "created", dir: "desc" });
  const range = parseRange(from, to);
  const created = rangeFilter(range);
  const pg = paging(page);
  const canEdit = user.permissions.has("crm.edit");
  const search = q?.trim();
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
  const base = leadScope(user);
  const where = {
    ...base,
    ...(stage ? { stageId: stage } : {}),
    ...(campaign ? { campaignId: campaign } : {}),
    ...(source ? { leadSourceId: source } : {}),
    ...(created ? { createdAt: created } : {}),
    ...(search ? { AND: [{ OR: [{ name: { contains: esc(search), mode: "insensitive" as const } }, { company: { contains: esc(search), mode: "insensitive" as const } }, { email: { contains: esc(search), mode: "insensitive" as const } }, { phone: { contains: search } }] }] } : {}),
  };
  const [leads, matched, dueNow, campaigns, stages, stageCounts] = await Promise.all([
    db.lead.findMany({ where, orderBy: orderFor(sort, SORTS), skip: pg.skip, take: pg.take, include: { stage: true } }),
    db.lead.count({ where }),
    db.lead.count({ where: { ...base, nextFollowUp: { lt: new Date() } } }),
    db.campaign.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, archivedAt: true } }),
    db.pipelineStage.findMany({ where: { organizationId: user.organizationId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.lead.groupBy({ by: ["stageId"], where: base, _count: true }),
  ]);
  const counts = new Map(stageCounts.map((c) => [c.stageId, c._count]));
  const total = stageCounts.reduce((n, c) => n + c._count, 0);
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ stage, campaign, source, from: range.from, to: range.to, src, q: search, sort: sortRaw && sort.key === sortRaw ? sort.key : undefined, dir: sortRaw && sort.key === sortRaw ? sort.dir : undefined, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/leads${t ? `?${t}` : ""}`; };
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
        <Stat label="Follow-ups overdue" value={dueNow} hint="across all your leads" />
        <Stat label="Stages" value={stages.length} />
      </div>
      <AppliedFilters items={[
        ...(campaign ? [{ label: `Campaign: ${campaignName.get(campaign) ?? "unknown"}`, removeHref: href({ campaign: undefined }) }] : []),
        ...(range.from || range.to ? [{ label: `Created ${rangeLabel(range)}`, removeHref: href({ from: undefined, to: undefined }) }] : []),
      ]} clearHref="/leads" backHref={src === "dashboard" ? "/dashboard" : campaign ? `/campaigns/${campaign}` : undefined} backLabel={src === "dashboard" ? "Back to dashboard" : "Back to the campaign"} />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={search} placeholder="Search name, company, email, phone" hidden={{ stage, campaign, from: range.from, to: range.to, src }} />
        <DateRangeForm from={range.from} to={range.to} label="Created" hidden={{ stage, campaign, q: search, src }} />
        <Chips current={stage ?? "all"} items={[{ key: "all", label: "All", count: total, href: href({ stage: undefined }) }, ...stages.map((st) => ({ key: st.id, label: st.name, count: counts.get(st.id) ?? 0, href: href({ stage: st.id }) }))]} />
      </div>

      {leads.length === 0 ? <Empty title={search ? "No leads match your search" : "No leads yet"}>{canEdit ? "Add your first lead below." : "Leads you own will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><SortTh label="Lead" field="name" sort={sort} hrefFor={href} className="px-4 py-2.5" /><th className="pr-4">Stage</th><th className="pr-4">Score</th><th className="pr-4">Campaign</th><SortTh label="Value" field="value" sort={sort} hrefFor={href} /><th className="pr-4">Last contact</th><SortTh label="Next follow-up" field="followup" sort={sort} hrefFor={href} /></tr></thead>
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
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
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
            <div><label className="label" htmlFor="campaignId">Campaign</label><select id="campaignId" name="campaignId" className="input" defaultValue=""><option value="">None</option>{campaigns.filter((c) => !c.archivedAt && ["ACTIVE", "PLANNED"].includes(c.status)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label" htmlFor="tags">Tags (comma separated)</label><input id="tags" name="tags" className="input" /></div>
            {dup && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="confirmDuplicate" value="1" /> Create anyway, I have checked the existing lead</label>}
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
