import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ContentError, editContent, transition } from "@/lib/content";
import { PLATFORMS, PLATFORM_META, POST_TYPES, POST_TYPE_LABEL, canTransition, isEditable, needsComment } from "@/lib/content-rules";
import { PlatformDot } from "../PostForm";
import { STATUS_STYLE } from "../status-style";
import FilesPanel from "@/components/FilesPanel";

export const dynamic = "force-dynamic";

const LABEL = (s: string) => s.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const back = (id: string, m: string): never => redirect(`/content/${id}?error=${encodeURIComponent(m)}`);

async function move(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const to = String(formData.get("to"));
  const user = await requirePermission(to === "SCHEDULED" || to === "PUBLISHED" ? "content.publish" : "content.manage");
  try {
    await transition(db, { organizationId: user.organizationId, id, actor: { id: user.id, type: "STAFF" }, to, comment: String(formData.get("comment") ?? "") });
    await audit(user, { action: `content.${to.toLowerCase()}`, entity: "ContentItem", entityId: id });
  } catch (e) {
    if (e instanceof ContentError) back(id, e.message);
    throw e;
  }
  redirect(`/content/${id}`);
}

async function save(formData: FormData) {
  "use server";
  const user = await requirePermission("content.manage");
  const id = String(formData.get("id"));
  try {
    await editContent(db, { organizationId: user.organizationId, id, copy: String(formData.get("copy") ?? ""), hashtags: String(formData.get("hashtags") ?? ""), title: String(formData.get("title") ?? ""), plannedDate: String(formData.get("plannedDate") ?? ""), plannedTime: String(formData.get("plannedTime") ?? ""), postType: String(formData.get("postType") ?? "") || undefined, platforms: formData.getAll("platforms").map(String) });
    await audit(user, { action: "content.edit", entity: "ContentItem", entityId: id });
  } catch (e) {
    if (e instanceof ContentError) back(id, e.message);
    throw e;
  }
  redirect(`/content/${id}`);
}

export default async function ContentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; fileError?: string; fileOk?: string; created?: string }> }) {
  const user = await requirePermission("content.view");
  const { id } = await params;
  const { error, fileError, fileOk, created } = await searchParams;
  const item = await db.contentItem.findFirst({ where: { id, organizationId: user.organizationId }, include: { events: { orderBy: { createdAt: "desc" } }, versions: { orderBy: { version: "desc" } } } });
  if (!item) notFound();
  const [client, people, clientUsers] = await Promise.all([
    item.clientId ? db.client.findUnique({ where: { id: item.clientId } }) : Promise.resolve(null),
    db.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } }),
    item.clientId ? db.user.findMany({ where: { clientId: item.clientId }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const who = (e: { actorId: string; actorType: string }) => [...people, ...clientUsers].find((p) => p.id === e.actorId)?.name ?? "Unknown";
  const canManage = user.permissions.has("content.manage");
  const canPublish = user.permissions.has("content.publish");
  const next = ["DRAFT", "INTERNAL_REVIEW", "CLIENT_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED"].filter((to) => canTransition("STAFF", item.status, to, Boolean(item.clientId)))
    .filter((to) => (to === "SCHEDULED" || to === "PUBLISHED" ? canPublish : canManage));
  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/content" className="text-sm text-muted hover:underline">← Content calendar</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{item.title} <span className="text-base font-normal text-muted">{LABEL(item.status)} · version {item.version}</span></h1>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${(STATUS_STYLE[item.status] ?? STATUS_STYLE.DRAFT).chip}`}>{(STATUS_STYLE[item.status] ?? STATUS_STYLE.DRAFT).label}</span>
        <span>{client?.name ?? "Our own account"}</span><span>·</span><span>{POST_TYPE_LABEL[item.postType] ?? item.postType}</span><span>·</span>
        <span className="inline-flex items-center gap-1">{(item.platforms.length ? item.platforms : [item.platform]).map((p) => <PlatformDot key={p} code={PLATFORM_META[p]?.code ?? "?"} color={PLATFORM_META[p]?.color ?? "#6b7280"} size={20} />)}</span>
        {item.plannedDate && <span>· {item.plannedDate}{item.plannedTime ? ` at ${item.plannedTime}` : ""}</span>}
      </div>
      {created && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">Post saved as a draft. Attach the creative below, then send it for review.</p>}
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}

      {canManage && isEditable(item.status) ? (
        <form action={save} className="card grid gap-3">
          <input type="hidden" name="id" value={item.id} />
          <div><label className="label" htmlFor="title">Title</label><input id="title" name="title" defaultValue={item.title} className="input" /></div>
          <div><label className="label" htmlFor="copy">Post copy (saving a change creates a new version)</label><textarea id="copy" name="copy" defaultValue={item.copy} rows={4} className="input" /></div>
          <fieldset><legend className="label">Platforms</legend><div className="flex flex-wrap gap-2">{PLATFORMS.filter((p) => p !== "OTHER" || item.platforms.includes("OTHER")).map((p) => <label key={p} className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"><input type="checkbox" name="platforms" value={p} defaultChecked={(item.platforms.length ? item.platforms : [item.platform]).includes(p)} className="sr-only" /><PlatformDot code={PLATFORM_META[p].code} color={PLATFORM_META[p].color} />{PLATFORM_META[p].label}</label>)}</div></fieldset>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="label" htmlFor="postType">Post type</label><select id="postType" name="postType" defaultValue={item.postType} className="input">{POST_TYPES.map((t) => <option key={t} value={t}>{POST_TYPE_LABEL[t]}</option>)}</select></div>
            <div><label className="label" htmlFor="plannedTime">Posting time</label><input id="plannedTime" name="plannedTime" type="time" defaultValue={item.plannedTime ?? ""} className="input" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="hashtags">Hashtags</label><input id="hashtags" name="hashtags" defaultValue={item.hashtags ?? ""} className="input" /></div>
            <div><label className="label" htmlFor="plannedDate">Planned date</label><input id="plannedDate" name="plannedDate" type="date" defaultValue={item.plannedDate ?? ""} className="input" /></div>
          </div>
          <div><button className="btn-ghost">Save</button></div>
        </form>
      ) : (
        <section className="card text-sm space-y-1"><p className="whitespace-pre-line">{item.copy}</p>{item.hashtags && <p className="text-muted">{item.hashtags}</p>}</section>
      )}

      <FilesPanel user={user} ownerType="CONTENT" ownerId={item.id} returnTo={`/content/${item.id}`} title="Creative files (images, video, documents)" flash={{ fileError, fileOk }} />

      {next.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Move this item</h2>
          <div className="flex flex-wrap gap-2">
            {next.map((to) => (
              <form key={to} action={move} className="flex gap-1 items-end">
                <input type="hidden" name="id" value={item.id} /><input type="hidden" name="to" value={to} />
                {needsComment(item.status, to) && <input name="comment" required placeholder="Reason" aria-label={`Reason for ${LABEL(to)}`} className="input !w-44" />}
                <button className={to === "PUBLISHED" ? "btn" : "btn-ghost"}>{to === "PUBLISHED" ? "Confirm it was published" : `To ${LABEL(to)}`}</button>
              </form>
            ))}
          </div>
          <p className="text-xs text-muted">Internal review must be completed by someone other than the author. Only the client can approve or request changes while it is in client review.</p>
        </section>
      )}

      <section className="card">
        <h2 className="font-semibold mb-2">History</h2>
        <ul className="text-sm space-y-1">
          {item.events.map((e) => (
            <li key={e.id} className="border-t border-border pt-1 first:border-0 first:pt-0">
              <span className="text-xs text-muted">{e.createdAt.toLocaleString()}</span> · <strong>{who(e)}</strong>{e.actorType === "CLIENT" && " (client)"}: {e.fromStatus ? `${LABEL(e.fromStatus)} to ` : "created as "}{LABEL(e.toStatus)}{e.comment && <span className="text-muted"> · &ldquo;{e.comment}&rdquo;</span>}
            </li>
          ))}
        </ul>
      </section>
      {item.versions.length > 1 && (
        <section className="card">
          <h2 className="font-semibold mb-2">Earlier versions</h2>
          {item.versions.slice(1).map((v) => <p key={v.id} className="text-sm border-t border-border py-1"><span className="text-xs text-muted">v{v.version}</span> {v.copy}</p>)}
        </section>
      )}
    </div>
  );
}
