import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ContentError, createContent } from "@/lib/content";
import { CONTENT_STATUSES, PLATFORMS } from "@/lib/content-rules";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("content.manage");
  let id: string;
  try {
    const item = await createContent(db, {
      organizationId: user.organizationId, clientId: String(formData.get("clientId")), platform: String(formData.get("platform")), title: String(formData.get("title") ?? ""),
      copy: String(formData.get("copy") ?? ""), hashtags: String(formData.get("hashtags") ?? ""), plannedDate: String(formData.get("plannedDate") ?? ""),
      assignedToId: String(formData.get("assignedToId") ?? "") || null, createdById: user.id,
    });
    id = item.id;
    await audit(user, { action: "content.create", entity: "ContentItem", entityId: item.id, after: { title: item.title } });
  } catch (e) {
    if (e instanceof ContentError) redirect(`/content?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/content/${id}`);
}

const LABEL = (s: string) => s.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default async function ContentCalendar({ searchParams }: { searchParams: Promise<{ error?: string; client?: string }> }) {
  const user = await requirePermission("content.view");
  const { error, client } = await searchParams;
  const [items, clients, people] = await Promise.all([
    db.contentItem.findMany({ where: { organizationId: user.organizationId, ...(client ? { clientId: client } : {}) }, orderBy: [{ plannedDate: "asc" }, { createdAt: "desc" }] }),
    db.client.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { organizationId: user.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const canManage = user.permissions.has("content.manage");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Content Calendar</h1>
      <p className="text-sm text-muted">Draft, internal review, client review, approved, scheduled, published. Content is marked published only when an authorized person confirms it; there is no direct posting to social platforms yet.</p>
      <nav aria-label="Client filter" className="flex flex-wrap gap-1">
        <Link href="/content" className={`btn-ghost ${!client ? "!bg-navy !text-white" : ""}`}>All clients</Link>
        {clients.map((c) => <Link key={c.id} href={`/content?client=${c.id}`} className={`btn-ghost ${client === c.id ? "!bg-navy !text-white" : ""}`}>{c.name}</Link>)}
      </nav>
      <div className="grid gap-3 lg:grid-cols-4 xl:grid-cols-7 overflow-x-auto">
        {CONTENT_STATUSES.map((s) => {
          const col = items.filter((i) => i.status === s);
          return (
            <section key={s} aria-label={LABEL(s)} className="rounded-xl bg-border/40 p-2 min-w-44">
              <h2 className="px-1 py-1 text-xs font-semibold text-muted">{LABEL(s)} · {col.length}</h2>
              <div className="space-y-2">
                {col.map((i) => (
                  <article key={i.id} className="card !p-3 text-sm space-y-1">
                    <Link href={`/content/${i.id}`} className="font-semibold hover:underline">{i.title}</Link>
                    <p className="text-xs text-muted">{clientName.get(i.clientId)} · {LABEL(i.platform)}{i.plannedDate && ` · ${i.plannedDate}`}</p>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {canManage && (
        <form action={create} className="card grid gap-4 sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">New content item</h2>
          {error && <p role="alert" className="sm:col-span-3 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          <div><label className="label" htmlFor="clientId">Client</label><select id="clientId" name="clientId" required className="input"><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="platform">Platform</label><select id="platform" name="platform" className="input">{PLATFORMS.map((p) => <option key={p} value={p}>{LABEL(p)}</option>)}</select></div>
          <div><label className="label" htmlFor="plannedDate">Planned date</label><input id="plannedDate" name="plannedDate" type="date" className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="title">Title</label><input id="title" name="title" required className="input" /></div>
          <div><label className="label" htmlFor="assignedToId">Assigned to</label><select id="assignedToId" name="assignedToId" className="input"><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="sm:col-span-3"><label className="label" htmlFor="copy">Post copy</label><textarea id="copy" name="copy" required rows={3} className="input" /></div>
          <div className="sm:col-span-3"><label className="label" htmlFor="hashtags">Hashtags</label><input id="hashtags" name="hashtags" className="input" /></div>
          <div className="sm:col-span-3"><button className="btn">Create draft</button></div>
        </form>
      )}
    </div>
  );
}
