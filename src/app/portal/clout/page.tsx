import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScope, getQuota } from "@/lib/clout";
import { POST_SORTS, SORT_COLUMNS, listPosts, totals } from "@/lib/clout-views";
import { PUBLIC_DATA_NOTE, TIMER_PRESETS } from "@/lib/clout-rules";
import { listHref, parseListParams } from "@/lib/list-params";
import { orderFor } from "@/lib/sort";
import type { Prisma } from "@prisma/client";
import { Empty, Notice, PageHeader, Pager, Stat, SubmitButton } from "@/components/ui";
import LiveRefresh from "@/components/clout/LiveRefresh";
import { PostTable, every, n } from "@/components/clout/parts";
import { portalRefreshCampaign, portalSetTimer } from "./actions";

export const dynamic = "force-dynamic";

export default async function PortalClout({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireClientUser();
  const sp = await searchParams;
  const lp = parseListParams(sp, { sorts: POST_SORTS, defaultSort: { key: "views", dir: "desc" } });
  const scope = clientScope(user.clientId);
  const client = await db.client.findUniqueOrThrow({ where: { id: user.clientId }, select: { organizationId: true } });
  const [t, list, campaigns, quota] = await Promise.all([
    totals(db, scope), listPosts(db, scope, orderFor(lp.sort, SORT_COLUMNS) as Prisma.CloutPostOrderByWithRelationInput[], lp.page.skip, lp.page.take),
    db.cloutCampaign.findMany({ where: { clientId: user.clientId }, include: { campaign: { select: { name: true } }, _count: { select: { posts: true } } }, orderBy: { campaign: { name: "asc" } } }),
    getQuota(db, client.organizationId, user.clientId),
  ]);
  const cur = { sort: lp.sortChosen ? lp.sort.key : undefined, dir: lp.sortChosen ? lp.sort.dir : undefined };
  const href = (over: Record<string, string | undefined>) => listHref("/portal/clout", cur, over);
  return (
    <div className="space-y-6">
      <PageHeader title="Influencer posts" subtitle="Live public numbers of the influencer posts made for your campaigns." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <p className="text-xs text-muted">{PUBLIC_DATA_NOTE}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total views" value={n(t.views)} /><Stat label="Total likes" value={n(t.likes)} /><Stat label="Total comments" value={n(t.comments)} /><Stat label="Live posts" value={n(t.live)} />
      </div>
      {campaigns.length > 0 && (
        <section className="card space-y-3" aria-label="Campaign timers">
          <h2 className="font-semibold">Update timers</h2>
          <p className="text-xs text-muted">Your plan allows {quota.fastPosts} post{quota.fastPosts === 1 ? "" : "s"} to update every 5 minutes or quicker at the same time; others update every 15 minutes. The fastest possible update is every {quota.minSeconds} seconds.</p>
          {campaigns.map((c) => (
            <div key={c.id} className="flex flex-wrap items-end gap-3 border-t border-border pt-3 first:border-0 first:pt-0">
              <p className="min-w-[10rem] font-medium">{c.campaign.name} <span className="block text-xs font-normal text-muted">{c._count.posts} post{c._count.posts === 1 ? "" : "s"}, updating every {every(c.refreshSeconds)}</span></p>
              <form action={portalSetTimer} className="flex items-end gap-2"><input type="hidden" name="cloutCampaignId" value={c.id} />
                <div><label className="label" htmlFor={`t-${c.id}`}>Update every</label><select id={`t-${c.id}`} name="seconds" className="input" defaultValue={String(c.refreshSeconds)}>{TIMER_PRESETS.filter((p) => p.seconds >= quota.minSeconds).map((p) => <option key={p.seconds} value={p.seconds}>{p.label}</option>)}</select></div>
                <SubmitButton pendingText="Saving…">Save</SubmitButton></form>
              <form action={portalRefreshCampaign}><input type="hidden" name="cloutCampaignId" value={c.id} /><SubmitButton pendingText="Queuing…">Refresh now</SubmitButton></form>
            </div>
          ))}
        </section>
      )}
      <div className="card !p-0 overflow-x-auto">
        {list.rows.length === 0 ? <div className="p-6"><Empty title="No posts yet">Posts made for your campaigns will appear here.</Empty></div> : <PostTable rows={list.rows} detailBase="/portal/clout" sort={lp.sort} hrefFor={href} />}
        <Pager page={lp.page.page} size={lp.page.size} total={list.total} href={(p) => href({ page: p > 1 ? String(p) : undefined })} />
      </div>
      <LiveRefresh seconds={20} />
    </div>
  );
}
