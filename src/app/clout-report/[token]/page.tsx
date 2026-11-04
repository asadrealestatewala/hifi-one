import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { sharedReport } from "@/lib/clout-views";
import { PUBLIC_DATA_NOTE } from "@/lib/clout-rules";
import { n, platformLabel } from "@/components/clout/parts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaign report", robots: { index: false, follow: false } };

// A read-only report for a client without a login. The secret in the address is the only key; it can be switched off at any time.
// It shows public numbers only: no notes, phone numbers, rates or internal errors.
export default async function SharedReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await sharedReport(db, token);
  if (!r) notFound();
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 py-8">
      <header><p className="text-xs text-muted">Hifi Marketing and Technologies</p><h1 className="text-2xl font-semibold tracking-tight">{r.name}: influencer post report</h1><p className="mt-1 text-xs text-muted">{PUBLIC_DATA_NOTE}</p></header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Total views", r.totals.views], ["Total likes", r.totals.likes], ["Total comments", r.totals.comments], ["Live posts", r.totals.live]].map(([l, v]) => <div key={l as string} className="card !p-4"><p className="text-xs font-medium text-muted">{l}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{n(v as number)}</p></div>)}
      </div>
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Platform</th><th className="pr-4">Post</th><th className="pr-4">Influencer</th><th className="pr-4">Views</th><th className="pr-4">Likes</th><th className="pr-4">Comments</th><th className="pr-4">Status</th></tr></thead>
          <tbody>{r.posts.map((p) => <tr key={p.id} className="border-t border-border"><td className="py-2 pl-4 pr-4">{platformLabel(p.platform)}</td><td className="pr-4"><a className="text-primary hover:underline" href={p.url} target="_blank" rel="noopener noreferrer">{p.author ? `@${p.author.replace(/^@/, "")}` : "Open post"}</a></td><td className="pr-4">{p.influencer ?? ""}</td><td className="pr-4 tabular-nums">{n(p.views)}</td><td className="pr-4 tabular-nums">{n(p.likes)}</td><td className="pr-4 tabular-nums">{n(p.comments)}</td><td className="pr-4">{p.status === "UNAVAILABLE" ? "Deleted / unavailable" : p.status === "PAUSED" ? "Paused" : "Live"}</td></tr>)}</tbody></table>
        {r.total > r.posts.length && <p className="p-3 text-xs text-muted">Showing the {r.posts.length} posts with the most views of {r.total}.</p>}
      </div>
    </main>
  );
}
