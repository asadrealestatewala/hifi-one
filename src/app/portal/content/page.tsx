import { redirect } from "next/navigation";
import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ContentError, bulkTransition, clientContent, transition } from "@/lib/content";
import { PLATFORM_META, cleanPlatformCopy } from "@/lib/content-rules";
import ConfirmButton from "@/components/ui/ConfirmButton";
import FilesPanel from "@/components/FilesPanel";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const LABEL = (s: string) => s.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

async function decide(formData: FormData) {
  "use server";
  const user = await requireClientUser();
  const to = String(formData.get("to"));
  if (to !== "APPROVED" && to !== "CHANGES_REQUESTED") redirect("/portal/content");
  try {
    // The item is checked against this user's own client inside the service, never against the form
    await transition(db, { organizationId: user.organizationId, id: String(formData.get("id")), actor: { id: user.id, type: "CLIENT", clientId: user.clientId }, to, comment: String(formData.get("comment") ?? "") });
  } catch (e) {
    if (e instanceof ContentError) redirect(`/portal/content?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/portal/content?ok=1");
}

// "Approve all" for one week: every post is checked against this client inside the service, never against the form
async function approveAll(formData: FormData) {
  "use server";
  const user = await requireClientUser();
  let msg: string;
  try {
    const r = await bulkTransition(db, { organizationId: user.organizationId, ids: formData.getAll("ids").map(String), actor: { id: user.id, type: "CLIENT", clientId: user.clientId }, to: "APPROVED" });
    msg = r.failed.length ? `${r.moved} approved. ${r.failed.length} could not be approved because they changed meanwhile.` : `${r.moved} post${r.moved === 1 ? "" : "s"} approved. Thank you.`;
  } catch (e) {
    if (e instanceof ContentError) redirect(`/portal/content?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/portal/content?done=${encodeURIComponent(msg)}`);
}

const mondayOf = (d: string) => { const t = Date.parse(d + "T00:00:00Z"); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10); };
const weekLabel = (monday: string) => monday === "none" ? "No date yet" : `Week of ${new Date(monday + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;

export default async function PortalContent({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; done?: string }> }) {
  const user = await requireClientUser();
  const { error, ok, done } = await searchParams;
  const items = await clientContent(db, user.clientId);
  const waiting = items.filter((i) => i.status === "CLIENT_REVIEW");
  const rest = items.filter((i) => i.status !== "CLIENT_REVIEW");
  const weeks = new Map<string, typeof waiting>();
  for (const i of waiting) { const k = i.plannedDate ? mondayOf(i.plannedDate) : "none"; weeks.set(k, [...(weeks.get(k) ?? []), i]); }
  return (
    <div className="space-y-6">
      <PageHeader title="Content for your approval" />
      {ok && <Notice kind="ok">Thank you. Your decision has been recorded.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="ok">{done}</Notice>}
      {waiting.length === 0 && <div className="card text-sm text-muted">Nothing is waiting for your approval.</div>}
      {[...weeks].map(([wk, list]) => (
        <section key={wk} className="space-y-3" aria-label={weekLabel(wk)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{weekLabel(wk)} <span className="text-sm font-normal text-muted">· {list.length} waiting</span></h2>
            {list.length > 1 && (
              <form action={approveAll}>
                {list.map((i) => <input key={i.id} type="hidden" name="ids" value={i.id} />)}
                <ConfirmButton className="btn" title={`Approve all ${list.length} posts for this week?`} message="Approve only after you have read every caption and looked at the files. You can still ask for changes on any post afterwards by contacting your project manager." confirmLabel="Approve all">Approve all {list.length}</ConfirmButton>
              </form>
            )}
          </div>
      {list.map((i) => (
        <article key={i.id} className="card space-y-3">
          <div className="flex justify-between gap-2"><h2 className="font-semibold">{i.title}</h2><span className="text-xs text-muted">{(i.platforms.length ? i.platforms : [i.platform]).map((p) => PLATFORM_META[p]?.label ?? LABEL(p)).join(", ")}{i.plannedDate && ` · planned ${i.plannedDate}`}{i.plannedTime && ` at ${i.plannedTime}`}</span></div>
          <p className="text-sm whitespace-pre-line">{i.copy}</p>
          {i.hashtags && <p className="text-sm text-muted">{i.hashtags}</p>}
          {Object.entries(cleanPlatformCopy(i.platformCopy)).map(([p, t]) => <div key={p} className="border-t border-border pt-2 text-sm"><p className="text-xs font-medium">{PLATFORM_META[p]?.label ?? p} version</p><p className="whitespace-pre-line">{t}</p></div>)}
          {i.firstComment && <p className="border-t border-border pt-2 text-sm"><span className="text-xs font-medium">First comment: </span>{i.firstComment}</p>}
          <FilesPanel user={user} ownerType="CONTENT" ownerId={i.id} returnTo="/portal/content" title="Files to review" />
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <form action={decide}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="to" value="APPROVED" /><button className="btn">Approve</button></form>
            <form action={decide} className="flex gap-2 items-end">
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="to" value="CHANGES_REQUESTED" />
              <input name="comment" required placeholder="What should change?" aria-label={`Changes needed for ${i.title}`} className="input !w-72" />
              <button className="btn-ghost">Request changes</button>
            </form>
          </div>
        </article>
      ))}
        </section>
      ))}
      {rest.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-2">Earlier content</h2>
          <ul className="text-sm">{rest.map((i) => <li key={i.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><span>{i.title}</span><span className="text-muted">{LABEL(i.status)}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
