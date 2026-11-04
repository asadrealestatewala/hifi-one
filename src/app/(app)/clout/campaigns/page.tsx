import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaignScope, canManage } from "@/lib/clout";
import { Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { every, n } from "@/components/clout/parts";
import { enableCampaignAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CloutCampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("clout.view");
  const sp = await searchParams;
  const manage = canManage(user);
  const [tracked, untracked, clients] = await Promise.all([
    db.cloutCampaign.findMany({ where: campaignScope(user), include: { campaign: { select: { name: true, code: true } }, client: { select: { name: true } }, _count: { select: { posts: true } } }, orderBy: { campaign: { name: "asc" } } }),
    manage ? db.campaign.findMany({ where: { organizationId: user.organizationId, archivedAt: null, clout: null }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" }, take: 300 }) : Promise.resolve([]),
    manage ? db.client.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const sums = await db.cloutPost.groupBy({ by: ["cloutCampaignId"], where: { cloutCampaignId: { in: tracked.map((t) => t.id) } }, _sum: { views: true } });
  const views = new Map(sums.map((s) => [s.cloutCampaignId, Number(s._sum.views ?? 0)]));
  return (
    <div className="space-y-6">
      <PageHeader title="Tracked campaigns" subtitle="Campaigns whose influencer posts are tracked. Each one has its own update timer." actions={<Link href="/clout" className="btn-ghost">Back to Clout Leader</Link>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <div className="card !p-0 overflow-x-auto">
        {tracked.length === 0 ? <div className="p-6"><Empty title="No tracked campaigns">{manage ? "Switch tracking on for a campaign below." : "You are not on any tracked campaign yet."}</Empty></div> : (
          <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Campaign</th><th className="pr-4">Client</th><th className="pr-4">Posts</th><th className="pr-4">Views</th><th className="pr-4">Updates every</th></tr></thead>
            <tbody>{tracked.map((c) => <tr key={c.id} className="border-t border-border hover:bg-hover/50"><td className="py-2 pl-4 pr-4"><Link className="font-medium text-primary hover:underline" href={`/clout/campaigns/${c.id}`}>{c.campaign.name}</Link>{c.campaign.code && <span className="ml-2 text-xs text-muted">{c.campaign.code}</span>}</td><td className="pr-4">{c.client?.name ?? <span className="text-muted">Company</span>}</td><td className="pr-4">{c._count.posts}</td><td className="pr-4 tabular-nums">{n(views.get(c.id) ?? 0)}</td><td className="pr-4">{every(c.refreshSeconds)}</td></tr>)}</tbody></table>
        )}
      </div>
      {manage && (
        <form action={enableCampaignAction} className="card flex flex-wrap items-end gap-3" aria-label="Track a campaign">
          <h2 className="w-full font-semibold">Track another campaign</h2>
          <div><label className="label" htmlFor="campaignId">Campaign</label><select id="campaignId" name="campaignId" required className="input" defaultValue=""><option value="" disabled>Choose a campaign</option>{untracked.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="clientId">Client (sees it in their portal)</label><select id="clientId" name="clientId" className="input" defaultValue=""><option value="">Company only</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <SubmitButton pendingText="Saving…">Start tracking</SubmitButton>
          {untracked.length === 0 && <p className="text-xs text-muted">Every campaign is already tracked. Create campaigns under Campaigns.</p>}
        </form>
      )}
    </div>
  );
}
