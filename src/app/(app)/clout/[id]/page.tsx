import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManage, getQuota, postScope, campaignScope, touchViewed } from "@/lib/clout";
import { postDetail } from "@/lib/clout-views";
import { PUBLIC_DATA_NOTE, TIMER_PRESETS, POST_COOLDOWN_SECONDS } from "@/lib/clout-rules";
import { ConfirmButton, Empty, Notice, PageHeader, Stat, SubmitButton } from "@/components/ui";
import GrowthChart from "@/components/clout/GrowthChart";
import LiveRefresh from "@/components/clout/LiveRefresh";
import { CloutStatus, ago, every, n, platformLabel, signed } from "@/components/clout/parts";
import { deletePostAction, postStateAction, refreshPostAction, setPostTimerAction, updateLinksAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("clout.view");
  const { id } = await params;
  const sp = await searchParams;
  const d = await postDetail(db, postScope(user), id);
  if (!d) notFound();
  after(() => touchViewed(db, [id]));
  const p = d.post;
  const manage = canManage(user);
  const cc = await db.cloutCampaign.findUnique({ where: { id: p.campaignId }, select: { clientId: true, refreshSeconds: true } });
  const quota = await getQuota(db, user.organizationId, cc?.clientId ?? null);
  const [influencers, projects] = await Promise.all([
    db.cloutInfluencer.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.project.findMany({ where: manage ? { organizationId: user.organizationId } : { organizationId: user.organizationId, campaignId: { in: (await db.cloutCampaign.findMany({ where: campaignScope(user), select: { campaignId: true } })).map((c) => c.campaignId) } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
  ]);
  const tracked = p.status === "LIVE" || p.status === "FAILED";
  const back = `/clout/${p.id}`;
  const g = d.growth;
  const recent = [...d.points].reverse().slice(0, 30);

  return (
    <div className="space-y-6">
      <PageHeader title={p.authorHandle ? `@${p.authorHandle.replace(/^@/, "")} on ${platformLabel(p.platform)}` : `${platformLabel(p.platform)} post`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><CloutStatus status={p.status} /><Link className="text-primary hover:underline" href={`/clout/campaigns/${p.campaignId}`}>{p.campaignName}</Link>{p.influencerName && <span>· {p.influencerName}</span>}{p.projectName && <span>· {p.projectName}</span>}</span>}
        actions={<>
          {tracked && <form action={refreshPostAction}><input type="hidden" name="postId" value={p.id} /><input type="hidden" name="back" value={back} /><SubmitButton pendingText="Refreshing…">Refresh now</SubmitButton></form>}
          <a className="btn-ghost" href={p.url} target="_blank" rel="noopener noreferrer">Open post</a>
        </>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {p.status === "UNAVAILABLE" && <Notice kind="error">This post was not found {3} times in a row, so it was marked deleted or unavailable and is no longer tracked. Its history is kept below.{manage && " If it is back, resume tracking below."}</Notice>}
      {p.status === "FAILED" && <Notice kind="error">The last check did not work{p.lastError ? `: ${p.lastError}` : ""}. It will be tried again automatically; the numbers below are from the last good check.</Notice>}
      {p.quotaFallback && <Notice kind="error">The fast lane is full for this client, so this post updates every {every(p.effectiveSeconds)} instead of the faster timer that was chosen. Ask an administrator to raise the quota ({quota.fastPosts} fast posts allowed).</Notice>}
      <p className="text-xs text-muted">{PUBLIC_DATA_NOTE}</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Views" value={n(p.views)} hint={g.sinceLast ? `${signed(g.sinceLast.views)} since last check` : undefined} />
        <Stat label="Likes" value={n(p.likes)} hint={g.sinceLast ? `${signed(g.sinceLast.likes)} since last check` : undefined} />
        <Stat label="Comments" value={n(p.comments)} hint={g.sinceLast ? `${signed(g.sinceLast.comments)} since last check` : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Shares" value={n(p.shares)} hint={p.shares == null ? "Not shown by this platform" : undefined} />
        <Stat label="Saves" value={n(p.saves)} hint={p.saves == null ? "Not shown by this platform" : undefined} />
        <Stat label="Views, last hour" value={g.hour ? signed(g.hour.views) : "–"} hint={g.hour?.partial ? "Since the first check" : g.hour ? undefined : "Needs two checks"} />
        <Stat label="Views, last 24 hours" value={g.day ? signed(g.day.views) : "–"} hint={g.day?.partial ? "Since the first check" : g.day ? undefined : "Needs two checks"} />
      </div>

      <section className="card space-y-3" aria-label="Details">
        <h2 className="font-semibold">Details</h2>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Last successful update</dt><dd>{ago(p.lastSuccessAt)}{p.lastProvider ? ` (${p.lastProvider === "YTDLP" ? "yt-dlp" : p.lastProvider === "APIFY" ? "Apify" : p.lastProvider})` : ""}</dd></div>
          <div><dt className="text-xs text-muted">Updates every</dt><dd>{tracked ? every(p.effectiveSeconds) : "Not tracked"}{p.pinned ? " · pinned (never slowed down)" : ""}{p.fastLane ? " · fast lane" : ""}</dd></div>
          <div><dt className="text-xs text-muted">Posted</dt><dd>{p.postedAt ? p.postedAt.toISOString().slice(0, 10) : "Not shown by this platform"}</dd></div>
          <div><dt className="text-xs text-muted">Added</dt><dd>{p.createdAt.toISOString().slice(0, 10)}</dd></div>
          {p.trackingCode && <div><dt className="text-xs text-muted">Promo code</dt><dd>{p.trackingCode}{d.conversions != null && <> · <strong>{d.conversions}</strong> lead{d.conversions === 1 ? "" : "s"} in the CRM</>}</dd></div>}
          {p.trackingLink && <div><dt className="text-xs text-muted">Tracking link</dt><dd className="break-all">{p.trackingLink}</dd></div>}
          {p.caption && <div className="sm:col-span-2"><dt className="text-xs text-muted">Caption</dt><dd className="whitespace-pre-line">{p.caption}</dd></div>}
        </dl>
      </section>

      <section className="space-y-3" aria-label="Growth">
        <h2 className="font-semibold">Growth over time</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <GrowthChart title="Views" points={d.chart} pick={(x) => x.views} tone="text-primary" />
          <GrowthChart title="Likes" points={d.chart} pick={(x) => x.likes} tone="text-brand" />
          <GrowthChart title="Comments" points={d.chart} pick={(x) => x.comments} tone="text-success" />
        </div>
      </section>

      {tracked && (
        <form action={setPostTimerAction} className="card flex flex-wrap items-end gap-3" aria-label="Update timer">
          <input type="hidden" name="postId" value={p.id} />
          <div><label className="label" htmlFor="seconds">How often this post updates</label>
            <select id="seconds" name="seconds" className="input" defaultValue={p.refreshSeconds ? String(p.refreshSeconds) : ""}>
              <option value="">Same as the campaign ({every(cc?.refreshSeconds ?? 900)})</option>
              {TIMER_PRESETS.filter((t) => t.seconds >= quota.minSeconds).map((t) => <option key={t.seconds} value={t.seconds}>Every {t.label}</option>)}
            </select></div>
          <SubmitButton pendingText="Saving…">Save timer</SubmitButton>
          <p className="text-xs text-muted">Never faster than every {quota.minSeconds} seconds. Refresh now can be used once every {POST_COOLDOWN_SECONDS} seconds. Posts older than a week slow down by themselves unless pinned.</p>
        </form>
      )}

      <form action={updateLinksAction} className="card grid gap-3 sm:grid-cols-2" aria-label="Links">
        <h2 className="font-semibold sm:col-span-2">Influencer, project and conversion tracking</h2>
        <input type="hidden" name="postId" value={p.id} />
        <div><label className="label" htmlFor="l-inf">Influencer</label><select id="l-inf" name="influencerId" className="input" defaultValue={p.influencerId ?? ""}><option value="">Not set</option>{influencers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        <div><label className="label" htmlFor="l-proj">Project</label><select id="l-proj" name="projectId" className="input" defaultValue={p.projectId ?? ""}><option value="">Not set</option>{projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div><label className="label" htmlFor="l-code">Promo code</label><input id="l-code" name="trackingCode" maxLength={60} defaultValue={p.trackingCode ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="l-link">Tracking link</label><input id="l-link" name="trackingLink" maxLength={500} defaultValue={p.trackingLink ?? ""} className="input" /></div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3"><SubmitButton pendingText="Saving…">Save</SubmitButton><p className="text-xs text-muted">Conversions cannot be read from a post. Leads in the CRM whose campaign tag (utm_campaign) or tags match the promo code are counted.</p></div>
      </form>

      {manage && (
        <section className="card flex flex-wrap items-center gap-3" aria-label="Manage">
          <h2 className="mr-2 font-semibold">Manage</h2>
          {p.status === "PAUSED" || p.status === "UNAVAILABLE"
            ? <form action={postStateAction}><input type="hidden" name="postId" value={p.id} /><input type="hidden" name="op" value="resume" /><SubmitButton pendingText="Saving…">Resume tracking</SubmitButton></form>
            : <form action={postStateAction}><input type="hidden" name="postId" value={p.id} /><input type="hidden" name="op" value="pause" /><SubmitButton pendingText="Saving…">Pause tracking</SubmitButton></form>}
          <form action={postStateAction}><input type="hidden" name="postId" value={p.id} /><input type="hidden" name="op" value={p.pinned ? "unpin" : "pin"} /><SubmitButton pendingText="Saving…">{p.pinned ? "Unpin" : "Pin (keep checking often)"}</SubmitButton></form>
          <form action={deletePostAction}><input type="hidden" name="postId" value={p.id} /><ConfirmButton title="Remove this post?" message="The post and all of its saved history will be deleted. This cannot be undone." confirmLabel="Remove post">Remove post</ConfirmButton></form>
        </section>
      )}

      <section className="card !p-0 overflow-x-auto" aria-label="Saved checks">
        <h2 className="p-4 pb-2 font-semibold">Recent checks <span className="text-xs font-normal text-muted">({d.snapshotCount} saved)</span></h2>
        {recent.length === 0 ? <div className="p-6"><Empty title="No successful check yet">The first numbers appear after the first successful update.</Empty></div> : (
          <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Time (UTC)</th><th className="pr-4">Views</th><th className="pr-4">Likes</th><th className="pr-4">Comments</th></tr></thead>
            <tbody>{recent.map((r) => <tr key={r.takenAt.toISOString()} className="border-t border-border"><td className="py-1.5 pl-4 pr-4 whitespace-nowrap">{r.takenAt.toISOString().slice(0, 19).replace("T", " ")}</td><td className="pr-4 tabular-nums">{n(r.views)}</td><td className="pr-4 tabular-nums">{n(r.likes)}</td><td className="pr-4 tabular-nums">{n(r.comments)}</td></tr>)}</tbody></table>
        )}
      </section>
      <LiveRefresh seconds={tracked ? 15 : 60} />
    </div>
  );
}
