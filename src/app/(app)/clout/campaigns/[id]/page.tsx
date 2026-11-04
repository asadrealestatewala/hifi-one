import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaignScope, canManage, getQuota, touchViewed } from "@/lib/clout";
import { POST_SORTS, SORT_COLUMNS, conversionsByInfluencer, listPosts, totals } from "@/lib/clout-views";
import { CAMPAIGN_COOLDOWN_SECONDS, PUBLIC_DATA_NOTE, TIMER_PRESETS } from "@/lib/clout-rules";
import { listHref, parseListParams } from "@/lib/list-params";
import { orderFor } from "@/lib/sort";
import { Empty, ExportLink, Notice, PageHeader, Pager, Stat, SubmitButton } from "@/components/ui";
import LiveRefresh from "@/components/clout/LiveRefresh";
import { PostTable, ago, every, n } from "@/components/clout/parts";
import { refreshCampaignAction, setCampaignClientAction, setCampaignTimerAction, toggleShareAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function CloutCampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("clout.view");
  const { id } = await params;
  const sp = await searchParams;
  const cc = await db.cloutCampaign.findFirst({ where: { id, ...campaignScope(user) }, include: { campaign: { select: { name: true, code: true } }, client: { select: { name: true } } } });
  if (!cc) notFound();
  const manage = canManage(user);
  const lp = parseListParams(sp, { sorts: POST_SORTS, defaultSort: { key: "views", dir: "desc" } });
  const where: Prisma.CloutPostWhereInput = { cloutCampaignId: cc.id };
  const [t, list, quota, clients, conv] = await Promise.all([
    totals(db, where), listPosts(db, where, orderFor(lp.sort, SORT_COLUMNS) as Prisma.CloutPostOrderByWithRelationInput[], lp.page.skip, lp.page.take), getQuota(db, user.organizationId, cc.clientId),
    manage ? db.client.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    conversionsByInfluencer(db, user.organizationId, where),
  ]);
  after(() => touchViewed(db, list.rows.map((r) => r.id)));
  const fell = await db.cloutPost.count({ where: { cloutCampaignId: cc.id, quotaFallback: true } });
  const base = `/clout/campaigns/${cc.id}`;
  const cur = { sort: lp.sortChosen ? lp.sort.key : undefined, dir: lp.sortChosen ? lp.sort.dir : undefined };
  const href = (over: Record<string, string | undefined>) => listHref(base, cur, over);
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");

  return (
    <div className="space-y-6">
      <PageHeader title={cc.campaign.name} subtitle={`Clout Leader · ${cc.client ? `for ${cc.client.name}` : "company campaign"}`} actions={<>
        <form action={refreshCampaignAction}><input type="hidden" name="cloutCampaignId" value={cc.id} /><SubmitButton pendingText="Queuing…">Refresh all now</SubmitButton></form>
        <ExportLink href={`/clout/export?kind=posts&cc=${cc.id}`} label="Export posts" />
        <ExportLink href={`/clout/export?kind=snapshots&cc=${cc.id}`} label="Export history" />
      </>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {fell > 0 && <Notice kind="error">{fell} post{fell === 1 ? "" : "s"} of this campaign could not get the fast lane ({quota.fastPosts} allowed for {cc.client?.name ?? "the company"}), so {fell === 1 ? "it updates" : "they update"} every 15 minutes instead.</Notice>}
      <p className="text-xs text-muted">{PUBLIC_DATA_NOTE}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total views" value={n(t.views)} /><Stat label="Total likes" value={n(t.likes)} /><Stat label="Total comments" value={n(t.comments)} /><Stat label="Live posts" value={n(t.live)} hint={`${t.posts} in total`} />
      </div>

      <form action={setCampaignTimerAction} className="card flex flex-wrap items-end gap-3" aria-label="Update timer">
        <input type="hidden" name="cloutCampaignId" value={cc.id} />
        <div><label className="label" htmlFor="seconds">Update the posts of this campaign</label>
          <select id="seconds" name="seconds" className="input" defaultValue={String(cc.refreshSeconds)}>
            {TIMER_PRESETS.filter((p) => p.seconds >= quota.minSeconds).map((p) => <option key={p.seconds} value={p.seconds}>Every {p.label}</option>)}
            {!TIMER_PRESETS.some((p) => p.seconds === cc.refreshSeconds) && <option value={cc.refreshSeconds}>Every {every(cc.refreshSeconds)}</option>}
          </select></div>
        <SubmitButton pendingText="Saving…">Save timer</SubmitButton>
        <p className="text-xs text-muted">Fastest allowed: every {quota.minSeconds} seconds. {quota.fastPosts} post{quota.fastPosts === 1 ? "" : "s"} at a time may update every 5 minutes or quicker; the rest fall back to 15 minutes. &quot;Refresh all&quot; can be used once a minute.</p>
      </form>

      <div className="card !p-0 overflow-x-auto">
        {list.rows.length === 0 ? <div className="p-6"><Empty title="No posts yet">Paste a post link on the <Link className="text-primary hover:underline" href="/clout">Clout Leader page</Link> and pick this campaign.</Empty></div> : <PostTable rows={list.rows} detailBase="/clout" sort={lp.sort} hrefFor={href} showCampaign={false} />}
        <Pager page={lp.page.page} size={lp.page.size} total={list.total} href={(p) => href({ page: p > 1 ? String(p) : undefined })} />
      </div>

      {conv.length > 0 && (
        <section className="card !p-0 overflow-x-auto" aria-label="Conversions by influencer">
          <h2 className="p-4 pb-2 font-semibold">Leads by promo code <span className="text-xs font-normal text-muted">(CRM leads whose utm_campaign or tags match a post&apos;s code)</span></h2>
          <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Influencer</th><th className="pr-4">Codes</th><th className="pr-4">Leads</th></tr></thead>
            <tbody>{conv.map((c) => <tr key={c.influencerId ?? "none"} className="border-t border-border"><td className="py-2 pl-4 pr-4">{c.name}</td><td className="pr-4">{c.codes.join(", ")}</td><td className="pr-4 tabular-nums">{c.leads}</td></tr>)}</tbody></table>
        </section>
      )}

      {manage && (
        <section className="card space-y-4" aria-label="Manage">
          <h2 className="font-semibold">Manage</h2>
          <form action={setCampaignClientAction} className="flex flex-wrap items-end gap-3"><input type="hidden" name="cloutCampaignId" value={cc.id} />
            <div><label className="label" htmlFor="clientId">Client (sees this campaign read-only in their portal, uses their quota)</label>
              <select id="clientId" name="clientId" className="input" defaultValue={cc.clientId ?? ""}><option value="">Company only</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <SubmitButton pendingText="Saving…">Save client</SubmitButton></form>
          <div className="flex flex-wrap items-center gap-3">
            {cc.shareToken ? (<>
              <p className="min-w-0 break-all text-sm">Shared report: <a className="text-primary hover:underline" href={`/clout-report/${cc.shareToken}`}>{appUrl}/clout-report/{cc.shareToken}</a></p>
              <form action={toggleShareAction}><input type="hidden" name="cloutCampaignId" value={cc.id} /><input type="hidden" name="on" value="0" /><SubmitButton pendingText="Saving…">Switch off share link</SubmitButton></form>
            </>) : (<form action={toggleShareAction} className="flex flex-wrap items-center gap-3"><input type="hidden" name="cloutCampaignId" value={cc.id} /><input type="hidden" name="on" value="1" /><SubmitButton pendingText="Creating…">Create share link</SubmitButton><p className="text-xs text-muted">A read-only page with the public numbers of this campaign&apos;s posts, for a client who has no login. Anyone with the link can open it until you switch it off.</p></form>)}
          </div>
          <p className="text-xs text-muted">Last &quot;refresh all&quot;: {ago(cc.lastRefreshAllAt)} (cooldown {CAMPAIGN_COOLDOWN_SECONDS} seconds).</p>
        </section>
      )}
      <LiveRefresh seconds={15} />
    </div>
  );
}
