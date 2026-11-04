import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { postScope } from "@/lib/clout";
import { breakdown, conversionsByInfluencer, listPosts, totals, type Group } from "@/lib/clout-views";
import { PUBLIC_DATA_NOTE } from "@/lib/clout-rules";
import { Empty, PageHeader } from "@/components/ui";
import { PostTable, n, platformLabel } from "@/components/clout/parts";

export const dynamic = "force-dynamic";
const METRICS = { views: "Views", likes: "Likes", comments: "Comments", live: "Live posts" } as const;
type Metric = keyof typeof METRICS;

function Table({ title, rows, metric, label }: { title: string; rows: Group[]; metric: Metric; label?: (k: string) => string }) {
  const val = (g: Group) => (metric === "live" ? g.posts : g[metric]);
  return (
    <section className="card !p-0 overflow-x-auto" aria-label={title}>
      <h2 className="p-4 pb-2 font-semibold">{title}</h2>
      {rows.length === 0 ? <div className="p-6"><Empty title="Nothing yet" /></div> : (
        <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">{title.replace("By ", "")}</th><th className="pr-4">Posts</th><th className="pr-4">{METRICS[metric]}</th></tr></thead>
          <tbody>{[...rows].sort((a, b) => val(b) - val(a)).map((g) => <tr key={g.key || "none"} className="border-t border-border"><td className="py-2 pl-4 pr-4">{label ? label(g.label) : g.label}</td><td className="pr-4 tabular-nums">{n(g.posts)}</td><td className="pr-4 tabular-nums">{n(val(g))}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}

// The detailed report behind each dashboard card: the same figure split by platform, campaign and influencer, plus the posts that contribute most
export default async function CloutReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("clout.view");
  const sp = await searchParams;
  const metric: Metric = (sp.metric && sp.metric in METRICS ? sp.metric : "views") as Metric;
  const scope = postScope(user);
  const where: Prisma.CloutPostWhereInput = metric === "live" ? { AND: [scope, { status: { in: ["LIVE", "FAILED"] } }] } : scope;
  const [t, byPlatform, byCampaign, byInfluencer, top, conv] = await Promise.all([
    totals(db, scope), breakdown(db, where, "platform"), breakdown(db, where, "campaign"), breakdown(db, where, "influencer"),
    listPosts(db, where, metric === "live" ? [{ lastSuccessAt: { sort: "desc", nulls: "last" } }, { id: "asc" }] : [{ [metric]: "desc" }, { id: "asc" }], 0, 15),
    conversionsByInfluencer(db, user.organizationId, scope),
  ]);
  const headline = metric === "views" ? t.views : metric === "likes" ? t.likes : metric === "comments" ? t.comments : t.live;
  return (
    <div className="space-y-6">
      <PageHeader title={`${METRICS[metric]}: report`} subtitle={<>Total {n(headline)} across {t.posts} post{t.posts === 1 ? "" : "s"}. <span className="text-muted">{PUBLIC_DATA_NOTE}</span></>} actions={<Link href="/clout" className="btn-ghost">Back to Clout Leader</Link>} />
      <nav aria-label="Metric" className="flex flex-wrap gap-1.5">{(Object.keys(METRICS) as Metric[]).map((m) => <Link key={m} href={`/clout/report?metric=${m}`} aria-current={m === metric ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${m === metric ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-hover"}`}>{METRICS[m]}</Link>)}</nav>
      <div className="grid gap-4 lg:grid-cols-3">
        <Table title="By platform" rows={byPlatform} metric={metric} label={platformLabel} />
        <Table title="By campaign" rows={byCampaign} metric={metric} />
        <Table title="By influencer" rows={byInfluencer} metric={metric} />
      </div>
      <section className="card !p-0 overflow-x-auto" aria-label="Top posts">
        <h2 className="p-4 pb-2 font-semibold">{metric === "live" ? "Most recently updated posts" : `Top posts by ${METRICS[metric].toLowerCase()}`}</h2>
        {top.rows.length === 0 ? <div className="p-6"><Empty title="No posts yet" /></div> : <PostTable rows={top.rows} detailBase="/clout" sort={{ key: metric, dir: "desc" }} hrefFor={() => `/clout/report?metric=${metric}`} />}
      </section>
      {conv.length > 0 && (
        <section className="card !p-0 overflow-x-auto" aria-label="Conversions">
          <h2 className="p-4 pb-2 font-semibold">Leads by influencer (promo code matches in the CRM)</h2>
          <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Influencer</th><th className="pr-4">Codes</th><th className="pr-4">Leads</th></tr></thead>
            <tbody>{conv.map((c) => <tr key={c.influencerId ?? "none"} className="border-t border-border"><td className="py-2 pl-4 pr-4">{c.name}</td><td className="pr-4">{c.codes.join(", ")}</td><td className="pr-4 tabular-nums">{c.leads}</td></tr>)}</tbody></table>
        </section>
      )}
    </div>
  );
}
