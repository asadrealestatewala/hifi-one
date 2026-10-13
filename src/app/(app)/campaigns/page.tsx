import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { campaignMetrics, campaignWhere } from "@/lib/campaigns";
import { CAMPAIGN_STATUSES } from "@/lib/crm";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { AppliedFilters, Chips, Empty, NewButton, Notice, PageHeader, PanelForm, Pager, SearchBox, Stat, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import { createCampaignAction } from "./actions";
import CampaignFields from "./CampaignFields";

export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; category?: string; owner?: string; member?: string; archived?: string; page?: string; from?: string; new?: string; error?: string; sort?: string };
const SORTS = { status: { label: "Status", by: [{ status: "asc" as const }, { name: "asc" as const }] }, name: { label: "Name", by: [{ name: "asc" as const }] }, code: { label: "Code", by: [{ code: "asc" as const }] }, start: { label: "Start date", by: [{ startDate: { sort: "desc" as const, nulls: "last" as const } }] } };
const KEYS = ["q", "status", "category", "owner", "member", "archived", "from", "sort"] as const;

export default async function Campaigns({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("campaigns.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("campaigns.manage");
  const q = sp.q?.trim();
  const status = (CAMPAIGN_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const filters = { q, status, categoryId: sp.category, ownerId: sp.owner === "me" ? user.id : sp.owner, memberId: sp.member === "me" ? user.id : sp.member, archived: sp.archived === "1" };
  const where = campaignWhere(org, filters);
  const pg = paging(sp.page);
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "status") as keyof typeof SORTS;
  const [rows, matched, byStatus, byCategory, categories, staff, archivedCount] = await Promise.all([
    db.campaign.findMany({ where, orderBy: [...SORTS[sort].by, { id: "asc" }], skip: pg.skip, take: pg.take, include: { category: { select: { name: true } } } }),
    db.campaign.count({ where }),
    db.campaign.groupBy({ by: ["status"], where: campaignWhere(org, {}), _count: true }),
    db.campaign.groupBy({ by: ["categoryId"], where: campaignWhere(org, {}), _count: true }),
    db.serviceCategory.findMany({ where: { organizationId: org, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE" }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true } }),
    db.campaign.count({ where: { organizationId: org, archivedAt: { not: null } } }),
  ]);
  const metrics = await campaignMetrics(db, org, rows.map((r) => r.id));
  const name = new Map(staff.map((u) => [u.id, u.name]));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const count = new Map(byStatus.map((s) => [s.status, s._count]));
  const total = byStatus.reduce((n, s) => n + s._count, 0);
  const current: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, k === "q" ? q : k === "status" ? status : sp[k]]));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/campaigns${t ? `?${t}` : ""}`; };
  const who = (v?: string) => (v === "me" ? "me" : name.get(v ?? "") ?? "unknown");
  const applied = [
    q && { label: `“${q}”`, removeHref: href({ q: undefined }) },
    sp.category && { label: `Category: ${catName.get(sp.category) ?? "unknown"}`, removeHref: href({ category: undefined }) },
    sp.owner && { label: `Owner: ${who(sp.owner)}`, removeHref: href({ owner: undefined }) },
    sp.member && { label: `Team member: ${who(sp.member)}`, removeHref: href({ member: undefined }) },
    sp.archived === "1" && { label: "Archived", removeHref: href({ archived: undefined }) },
  ].filter(Boolean) as { label: string; removeHref: string }[];
  const topCats = byCategory.filter((c) => c.categoryId).sort((a, b) => b._count - a._count).slice(0, 2);
  return (
    <div className="space-y-5">
      <PageHeader title="Campaigns" subtitle="Every campaign with its category, team, clients, projects and the leads it brought in." actions={canManage ? <NewButton href={href({ new: "1" })}>New campaign</NewButton> : undefined} />
      {sp.error && !sp.new && <Notice kind="error">{sp.error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Campaigns" value={total} href="/campaigns" />
        <Stat label="Active" value={count.get("ACTIVE") ?? 0} href="/campaigns?status=ACTIVE" />
        {topCats.map((c) => <Stat key={c.categoryId} label={catName.get(c.categoryId!) ?? "Category"} value={c._count} hint="by category" href={`/campaigns?category=${c.categoryId}`} />)}
        <Stat label="Archived" value={archivedCount} href="/campaigns?archived=1" />
      </div>
      <AppliedFilters items={applied} clearHref="/campaigns" backHref={sp.from === "dashboard" ? "/dashboard" : undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search name, code or description" hidden={{ ...current, q: undefined }} />
        {sp.archived !== "1" && <Chips current={status ?? "all"} items={[{ key: "all", label: "All", count: total, href: href({ status: undefined }) }, ...CAMPAIGN_STATUSES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase(), count: count.get(s) ?? 0, href: href({ status: s }) }))]} />}
        <form className="flex flex-wrap gap-2" aria-label="More filters">
          {Object.entries(current).filter(([k, v]) => v && k !== "category" && k !== "sort").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <select name="sort" defaultValue={sort} aria-label="Sort by" className="input !w-auto">{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v.label}</option>)}</select>
          <select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className="input !w-auto"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="btn-ghost">Apply</button>
        </form>
        <Link href={href({ member: "me" })} className="btn-ghost">My campaigns</Link>
      </div>
      {rows.length === 0 ? <Empty title={applied.length || status ? "No campaigns match" : "No campaigns yet"}>{applied.length || status ? <Link href="/campaigns" className="underline">Clear the filters</Link> : canManage ? "Create the first one with New campaign." : "Campaigns will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Campaign</th><th className="pr-4">Category</th><th className="pr-4">Status</th><th className="pr-4">Owner</th><th className="pr-4 text-right">Team</th><th className="pr-4 text-right">Leads</th><th className="pr-4 text-right">Won</th><th className="pr-4 text-right">Projects</th><th className="pr-4 text-right">Open tasks</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const m = metrics.get(c.id)!;
                return (
                  <tr key={c.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-2.5"><Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link><span className="block text-xs text-muted">{c.code}{c.startDate && ` · ${c.startDate}${c.endDate ? ` to ${c.endDate}` : ""}`}</span></td>
                    <td className="pr-4 text-muted">{c.category?.name ?? "Not set"}</td>
                    <td className="pr-4">{c.archivedAt ? <StatusBadge status="ARCHIVED" /> : <StatusBadge status={c.status} />}</td>
                    <td className="pr-4 text-muted">{c.ownerId ? name.get(c.ownerId) : ""}</td>
                    <td className="pr-4 text-right tabular-nums">{m.team}</td>
                    <td className="pr-4 text-right tabular-nums"><Link className="hover:underline" href={`/leads?campaign=${c.id}`}>{m.leads}</Link></td>
                    <td className="pr-4 text-right tabular-nums">{m.won}</td>
                    <td className="pr-4 text-right tabular-nums">{m.projects}</td>
                    <td className="pr-4 text-right tabular-nums">{m.openTasks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
        </div>
      )}
      {canManage && sp.new && (
        <Drawer title="New campaign" closeTo={href({ new: undefined, error: undefined })}>
          <PanelForm action={createCampaignAction} closeTo={href({ new: undefined, error: undefined })} submit="Create campaign" error={sp.error} hint="Only the name is required. The code is assigned automatically.">
            <CampaignFields categories={categories} staff={staff.filter((u) => u.active)} />
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
