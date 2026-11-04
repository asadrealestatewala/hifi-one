import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/clout";
import { postDetail } from "@/lib/clout-views";
import { PUBLIC_DATA_NOTE, POST_COOLDOWN_SECONDS } from "@/lib/clout-rules";
import { Notice, PageHeader, Stat, SubmitButton } from "@/components/ui";
import GrowthChart from "@/components/clout/GrowthChart";
import LiveRefresh from "@/components/clout/LiveRefresh";
import { CloutStatus, ago, every, n, platformLabel, signed } from "@/components/clout/parts";
import { portalRefreshPost } from "../actions";

export const dynamic = "force-dynamic";

export default async function PortalCloutPost({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireClientUser();
  const { id } = await params;
  const sp = await searchParams;
  const d = await postDetail(db, clientScope(user.clientId), id);
  if (!d) notFound();
  const p = d.post;
  const tracked = p.status === "LIVE" || p.status === "FAILED";
  const g = d.growth;
  return (
    <div className="space-y-6">
      <PageHeader title={p.authorHandle ? `@${p.authorHandle.replace(/^@/, "")} on ${platformLabel(p.platform)}` : `${platformLabel(p.platform)} post`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><CloutStatus status={p.status} /><span>{p.campaignName}</span>{p.influencerName && <span>· {p.influencerName}</span>}</span>}
        actions={<>{tracked && <form action={portalRefreshPost}><input type="hidden" name="postId" value={p.id} /><SubmitButton pendingText="Refreshing…">Refresh now</SubmitButton></form>}<a className="btn-ghost" href={p.url} target="_blank" rel="noopener noreferrer">Open post</a><Link href="/portal/clout" className="btn-ghost">All posts</Link></>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {p.status === "UNAVAILABLE" && <Notice kind="error">This post was deleted or made private, so it is not tracked any more. Its history is kept below.</Notice>}
      <p className="text-xs text-muted">{PUBLIC_DATA_NOTE}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Views" value={n(p.views)} hint={g.sinceLast ? `${signed(g.sinceLast.views)} since last check` : undefined} />
        <Stat label="Likes" value={n(p.likes)} hint={g.sinceLast ? `${signed(g.sinceLast.likes)} since last check` : undefined} />
        <Stat label="Comments" value={n(p.comments)} hint={g.sinceLast ? `${signed(g.sinceLast.comments)} since last check` : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Views, last hour" value={g.hour ? signed(g.hour.views) : "–"} /><Stat label="Views, last 24 hours" value={g.day ? signed(g.day.views) : "–"} /><Stat label="Last updated" value={ago(p.lastSuccessAt)} hint={tracked ? `Updates every ${every(p.effectiveSeconds)}` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <GrowthChart title="Views" points={d.chart} pick={(x) => x.views} tone="text-primary" />
        <GrowthChart title="Likes" points={d.chart} pick={(x) => x.likes} tone="text-brand" />
        <GrowthChart title="Comments" points={d.chart} pick={(x) => x.comments} tone="text-success" />
      </div>
      {tracked && <p className="text-xs text-muted">Refresh now can be used once every {POST_COOLDOWN_SECONDS} seconds.</p>}
      <LiveRefresh seconds={tracked ? 20 : 60} />
    </div>
  );
}
