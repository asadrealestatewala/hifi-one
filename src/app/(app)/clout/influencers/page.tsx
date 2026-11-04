import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { CURRENCIES } from "@/lib/money";
import { saveInfluencerAction } from "../actions";

export const dynamic = "force-dynamic";
type Handles = Record<string, string>;

export default async function InfluencersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("clout.manage");
  const sp = await searchParams;
  const [rows, counts] = await Promise.all([
    db.cloutInfluencer.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } }),
    db.cloutPost.groupBy({ by: ["influencerId"], where: { organizationId: user.organizationId, influencerId: { not: null } }, _count: true }),
  ]);
  const posts = new Map(counts.map((c) => [c.influencerId, c._count]));
  const editing = rows.find((r) => r.id === sp.edit);
  const h = (editing?.handles ?? {}) as Handles;
  return (
    <div className="space-y-6">
      <PageHeader title="Influencers" subtitle="The people who post for your campaigns. A campaign can have several, and an influencer can have many posts." actions={<Link href="/clout" className="btn-ghost">Back to Clout Leader</Link>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <div className="card !p-0 overflow-x-auto">
        {rows.length === 0 ? <div className="p-6"><Empty title="No influencers yet">Add the first one below.</Empty></div> : (
          <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Name</th><th className="pr-4">Handles</th><th className="pr-4">Phone</th><th className="pr-4">Rate</th><th className="pr-4">Posts</th><th className="pr-4"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>{rows.map((r) => { const hh = r.handles as Handles; return (
              <tr key={r.id} className="border-t border-border align-top hover:bg-hover/50"><td className="py-2 pl-4 pr-4 font-medium">{r.name}{!r.active && <span className="ml-2 text-xs text-muted">inactive</span>}{r.notes && <p className="text-xs font-normal text-muted">{r.notes}</p>}</td>
                <td className="pr-4 text-xs">{Object.entries(hh).map(([k, v]) => <p key={k}>{k.charAt(0) + k.slice(1).toLowerCase()}: {v}</p>)}</td>
                <td className="pr-4">{r.phone ?? <span className="text-muted">None</span>}</td><td className="pr-4">{r.rate ? `${r.rate.toString()} ${r.rateCurrency}` : <span className="text-muted">Not set</span>}</td>
                <td className="pr-4">{posts.get(r.id) ?? 0}</td><td className="pr-4"><Link className="text-primary hover:underline" href={`/clout/influencers?edit=${r.id}#form`}>Edit</Link></td></tr>); })}</tbody></table>
        )}
      </div>
      <form id="form" action={saveInfluencerAction} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={editing ? "Edit influencer" : "Add influencer"} key={editing?.id ?? "new"}>
        <h2 className="font-semibold sm:col-span-2 lg:col-span-3">{editing ? `Edit ${editing.name}` : "Add an influencer"}</h2>
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" required minLength={2} maxLength={100} defaultValue={editing?.name ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" maxLength={40} defaultValue={editing?.phone ?? ""} className="input" /></div>
        <div className="flex gap-2"><div className="flex-1"><label className="label" htmlFor="rate">Rate (optional)</label><input id="rate" name="rate" inputMode="decimal" maxLength={20} defaultValue={editing?.rate?.toString() ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="rateCurrency">Currency</label><select id="rateCurrency" name="rateCurrency" defaultValue={editing?.rateCurrency ?? "USD"} className="input">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></div>
        <div><label className="label" htmlFor="tiktok">TikTok handle</label><input id="tiktok" name="tiktok" maxLength={120} defaultValue={h.TIKTOK ?? ""} className="input" placeholder="@name" /></div>
        <div><label className="label" htmlFor="instagram">Instagram handle</label><input id="instagram" name="instagram" maxLength={120} defaultValue={h.INSTAGRAM ?? ""} className="input" placeholder="@name" /></div>
        <div><label className="label" htmlFor="facebook">Facebook page or profile</label><input id="facebook" name="facebook" maxLength={120} defaultValue={h.FACEBOOK ?? ""} className="input" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><input id="notes" name="notes" maxLength={1000} defaultValue={editing?.notes ?? ""} className="input" /></div>
        {editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" value="on" defaultChecked={editing.active} />Active</label>}
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3"><SubmitButton pendingText="Saving…">{editing ? "Save influencer" : "Add influencer"}</SubmitButton>{editing && <Link className="btn-ghost" href="/clout/influencers">Cancel</Link>}</div>
      </form>
    </div>
  );
}
