import { redirect } from "next/navigation";
import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ContentError, clientContent, transition } from "@/lib/content";

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

export default async function PortalContent({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireClientUser();
  const { error, ok } = await searchParams;
  const items = await clientContent(db, user.clientId);
  const waiting = items.filter((i) => i.status === "CLIENT_REVIEW");
  const rest = items.filter((i) => i.status !== "CLIENT_REVIEW");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Content for your approval</h1>
      {ok && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">Thank you. Your decision has been recorded.</p>}
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      {waiting.length === 0 && <div className="card text-sm text-muted">Nothing is waiting for your approval.</div>}
      {waiting.map((i) => (
        <article key={i.id} className="card space-y-3">
          <div className="flex justify-between gap-2"><h2 className="font-semibold">{i.title}</h2><span className="text-xs text-muted">{LABEL(i.platform)}{i.plannedDate && ` · planned ${i.plannedDate}`}</span></div>
          <p className="text-sm whitespace-pre-line">{i.copy}</p>
          {i.hashtags && <p className="text-sm text-muted">{i.hashtags}</p>}
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
      {rest.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-2">Earlier content</h2>
          <ul className="text-sm">{rest.map((i) => <li key={i.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><span>{i.title}</span><span className="text-muted">{LABEL(i.status)}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
