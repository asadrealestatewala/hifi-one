import Link from "next/link";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManage, platformHealth, postScope, touchViewed, campaignScope } from "@/lib/clout";
import { POST_SORTS, SORT_COLUMNS, listPosts, totals } from "@/lib/clout-views";
import { PLATFORMS, POST_STATUSES, PUBLIC_DATA_NOTE } from "@/lib/clout-rules";
import { listHref, parseListParams } from "@/lib/list-params";
import { orderFor } from "@/lib/sort";
import { Badge, Chips, Empty, ExportLink, Notice, PageHeader, Pager, SearchBox, Stat, SubmitButton } from "@/components/ui";
import LiveRefresh from "@/components/clout/LiveRefresh";
import { PostTable, n, platformLabel } from "@/components/clout/parts";
import { addPostAction } from "./actions";

export const dynamic = "force-dynamic";
const BASE = "/clout";
const STATUS_LABEL: Record<string, string> = { LIVE: "Live", FAILED: "Failed", UNAVAILABLE: "Deleted / unavailable", PAUSED: "Paused" };
const HEALTH_TONE = { OK: "success", DEGRADED: "warning", BLOCKED: "danger" } as const;

export default async function CloutPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("clout.view");
  const sp = await searchParams;
  const lp = parseListParams(sp, { sorts: POST_SORTS, defaultSort: { key: "added", dir: "desc" }, statuses: POST_STATUSES, ids: ["campaign", "influencer"] });
  const platform = (PLATFORMS as readonly string[]).includes(sp.platform ?? "") ? sp.platform : undefined;
  const manage = canManage(user);

  const scope = postScope(user);
  const where: Prisma.CloutPostWhereInput = {
    AND: [scope, lp.status ? { status: lp.status } : {}, platform ? { platform } : {}, lp.ids.campaign ? { cloutCampaignId: lp.ids.campaign } : {}, lp.ids.influencer ? { influencerId: lp.ids.influencer } : {},
      lp.q ? { OR: [{ caption: { contains: lp.q, mode: "insensitive" } }, { authorHandle: { contains: lp.q, mode: "insensitive" } }, { url: { contains: lp.q, mode: "insensitive" } }, { influencer: { name: { contains: lp.q, mode: "insensitive" } } }, { trackingCode: { contains: lp.q, mode: "insensitive" } }] } : {}],
  };
  const [list, t, statusCounts, campaigns, influencers, health] = await Promise.all([
    listPosts(db, where, orderFor(lp.sort, SORT_COLUMNS) as Prisma.CloutPostOrderByWithRelationInput[], lp.page.skip, lp.page.take),
    totals(db, scope),
    db.cloutPost.groupBy({ by: ["status"], where: scope, _count: true }),
    db.cloutCampaign.findMany({ where: campaignScope(user), select: { id: true, campaign: { select: { name: true } } }, orderBy: { campaign: { name: "asc" } } }),
    db.cloutInfluencer.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    manage || user.permissions.has("clout.settings") ? platformHealth(db, user.organizationId) : Promise.resolve(null),
  ]);
  const projects = await db.project.findMany({ where: manage ? { organizationId: user.organizationId } : { organizationId: user.organizationId, campaignId: { in: campaigns.length ? (await db.cloutCampaign.findMany({ where: campaignScope(user), select: { campaignId: true } })).map((c) => c.campaignId) : [] } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 });
  after(() => touchViewed(db, list.rows.map((r) => r.id)));

  const byStatus = new Map(statusCounts.map((c) => [c.status, c._count]));
  const cur = { q: lp.q, status: lp.status, platform, campaign: lp.ids.campaign, influencer: lp.ids.influencer, sort: lp.sortChosen ? lp.sort.key : undefined, dir: lp.sortChosen ? lp.sort.dir : undefined };
  const href = (over: Record<string, string | undefined>) => listHref(BASE, cur, over);
  const exportQs = new URLSearchParams(Object.entries({ q: lp.q, status: lp.status, platform, campaign: lp.ids.campaign, influencer: lp.ids.influencer }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-6">
      <PageHeader title="Clout Leader" subtitle="Paste the link of a post an influencer made and see its public views, likes and comments, kept up to date for as long as the post exists."
        actions={<><Link href="/clout/campaigns" className="btn-ghost">Campaigns</Link>{manage && <Link href="/clout/influencers" className="btn-ghost">Influencers</Link>}{user.permissions.has("clout.settings") && <Link href="/clout/settings" className="btn-ghost">Settings</Link>}<ExportLink href={`/clout/export?kind=posts${exportQs ? `&${exportQs}` : ""}`} /></>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <p className="text-xs text-muted">{PUBLIC_DATA_NOTE}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total views" value={n(t.views)} href="/clout/report?metric=views" hint={`${t.posts} post${t.posts === 1 ? "" : "s"} tracked`} />
        <Stat label="Total likes" value={n(t.likes)} href="/clout/report?metric=likes" />
        <Stat label="Total comments" value={n(t.comments)} href="/clout/report?metric=comments" />
        <Stat label="Live posts" value={n(t.live)} href="/clout/report?metric=live" hint={t.unavailable > 0 ? `${t.unavailable} deleted or unavailable` : undefined} />
      </div>

      {health && (
        <section className="card flex flex-wrap items-center gap-3" aria-label="Platform health">
          <h2 className="font-semibold">Platform health</h2>
          {health.map((h) => <span key={h.platform} className="flex items-center gap-1.5 text-sm"><Badge tone={HEALTH_TONE[h.health]}>{h.health === "OK" ? "OK" : h.health === "DEGRADED" ? "Degraded" : "Blocked"}</Badge>{platformLabel(h.platform)}{h.health !== "OK" && h.lastError && <span className="max-w-[16rem] truncate text-xs text-muted" title={h.lastError}>{h.lastError}</span>}</span>)}
        </section>
      )}

      {campaigns.length === 0 ? (
        <Notice kind="error">{manage ? <>No campaign is being tracked yet. <Link className="underline" href="/clout/campaigns">Switch tracking on for a campaign</Link> first, then paste post links here.</> : "You are not on any tracked campaign yet. Ask a manager to add you to one."}</Notice>
      ) : (
        <form action={addPostAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Add a post">
          <input type="hidden" name="back" value={BASE} />
          <h2 className="font-semibold sm:col-span-2 lg:col-span-4">Add a post</h2>
          <div className="sm:col-span-2 lg:col-span-4"><label className="label" htmlFor="url">Post link</label><input id="url" name="url" required maxLength={600} placeholder="https://www.tiktok.com/@name/video/…  ·  instagram.com/reel/…  ·  facebook.com/reel/…" className="input" autoComplete="off" /></div>
          <div><label className="label" htmlFor="cloutCampaignId">Campaign</label><select id="cloutCampaignId" name="cloutCampaignId" required className="input" defaultValue={lp.ids.campaign ?? ""}><option value="" disabled>Choose a campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.campaign.name}</option>)}</select></div>
          <div><label className="label" htmlFor="influencerId">Influencer</label><select id="influencerId" name="influencerId" className="input" defaultValue=""><option value="">Not set</option>{influencers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
          <div><label className="label" htmlFor="projectId">Project</label><select id="projectId" name="projectId" className="input" defaultValue=""><option value="">Not set</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="label" htmlFor="trackingCode">Promo code (optional)</label><input id="trackingCode" name="trackingCode" maxLength={60} className="input" placeholder="e.g. SARA10" /></div>
          <div className="lg:col-span-3"><label className="label" htmlFor="trackingLink">Tracking link (optional)</label><input id="trackingLink" name="trackingLink" maxLength={500} className="input" placeholder="https://hifimarketing.co/?utm_campaign=SARA10" /></div>
          <div className="flex items-end"><SubmitButton pendingText="Fetching numbers…">Add and fetch</SubmitButton></div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Chips current={lp.status ?? "ALL"} items={[{ key: "ALL", label: "All", count: t.posts, href: href({ status: undefined, page: undefined }) }, ...POST_STATUSES.map((st) => ({ key: st, label: STATUS_LABEL[st], count: byStatus.get(st) ?? 0, href: href({ status: st, page: undefined }) }))]} />
        <SearchBox q={lp.q} placeholder="Search caption, handle, influencer, code" hidden={{ status: lp.status, platform, campaign: lp.ids.campaign, influencer: lp.ids.influencer }} />
      </div>
      <form className="flex flex-wrap items-end gap-3" aria-label="Filter posts">
        {lp.q && <input type="hidden" name="q" value={lp.q} />}{lp.status && <input type="hidden" name="status" value={lp.status} />}
        <div><label className="label" htmlFor="f-platform">Platform</label><select id="f-platform" name="platform" className="input" defaultValue={platform ?? ""}><option value="">All</option>{PLATFORMS.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}</select></div>
        <div><label className="label" htmlFor="f-campaign">Campaign</label><select id="f-campaign" name="campaign" className="input" defaultValue={lp.ids.campaign ?? ""}><option value="">All</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.campaign.name}</option>)}</select></div>
        <div><label className="label" htmlFor="f-influencer">Influencer</label><select id="f-influencer" name="influencer" className="input" defaultValue={lp.ids.influencer ?? ""}><option value="">All</option>{influencers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        <button className="btn-ghost">Apply filters</button>
      </form>

      <div className="card !p-0 overflow-x-auto">
        {list.rows.length === 0 ? (
          <div className="p-6"><Empty title={t.posts === 0 ? "No posts yet" : "No posts match"}>{t.posts === 0 ? "Paste a post link above to start tracking it." : "Try another status, platform or search."}</Empty></div>
        ) : <PostTable rows={list.rows} detailBase="/clout" sort={lp.sort} hrefFor={href} />}
        <Pager page={lp.page.page} size={lp.page.size} total={list.total} href={(p) => href({ page: p > 1 ? String(p) : undefined })} />
      </div>
      <LiveRefresh seconds={15} />
    </div>
  );
}
