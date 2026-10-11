import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { Badge, Empty, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { MonitorError, deleteScreenshot } from "@/lib/monitoring";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function remove(formData: FormData) {
  "use server";
  const user = await requirePermission("monitoring.screenshots");
  const id = String(formData.get("id") ?? "");
  try {
    await deleteScreenshot(db, defaultStorage(), { organizationId: user.organizationId, id });
    await audit(user, { action: "monitoring.screenshot_delete", entity: "Screenshot", entityId: id });
  } catch (e) {
    if (e instanceof MonitorError) redirect(`/hr/monitoring/screenshots?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/hr/monitoring/screenshots");
}

// Thumbnails load through the logged route, so every one that is shown is recorded against the person it belongs to.
export default async function Screenshots({ searchParams }: { searchParams: Promise<{ user?: string; day?: string; disputed?: string; error?: string }> }) {
  const user = await requirePermission("monitoring.screenshots");
  const sp = await searchParams;
  const org = user.organizationId;
  const day = ISO.test(sp.day ?? "") ? sp.day! : new Date().toISOString().slice(0, 10);
  const people = await db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const shots = sp.user || sp.disputed ? await db.screenshot.findMany({
    where: { organizationId: org, deletedAt: null, ...(sp.user ? { userId: sp.user } : {}), ...(sp.disputed ? { disputed: true } : { capturedAt: { gte: new Date(`${day}T00:00:00Z`), lte: new Date(`${day}T23:59:59.999Z`) } }) },
    orderBy: { capturedAt: "desc" }, take: 60,
  }) : [];
  const name = new Map(people.map((p) => [p.id, p.name]));
  const flagged = await db.screenshot.count({ where: { organizationId: org, deletedAt: null, disputed: true } });
  return (
    <div className="space-y-6">
      <PageHeader title="Screenshots" subtitle="Choose a person and a day. Each screenshot you open is logged, and the person can see that you looked." actions={<Link href="/hr/monitoring" className="btn-ghost">Activity report</Link>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <form className="card flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="u">Person</label><select id="u" name="user" defaultValue={sp.user ?? ""} className="input"><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div><label className="label" htmlFor="d">Day</label><input id="d" name="day" type="date" defaultValue={day} className="input" /></div>
        <button className="btn">Show</button>
        <Link href="/hr/monitoring/screenshots?disputed=1" className="btn-ghost">Flagged by employees ({flagged})</Link>
      </form>
      {!sp.user && !sp.disputed ? <Empty title="Pick a person">Screenshots are never shown in bulk across everyone.</Empty> : shots.length === 0 ? <Empty title="No screenshots for this view" /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shots.map((s) => (
          <figure key={s.id} className="card !p-3 space-y-2 text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={`/api/screenshots/${s.id}`} target="_blank" rel="noopener"><img src={`/api/screenshots/${s.id}`} alt={`Screenshot of ${name.get(s.userId) ?? "an employee"} at ${s.capturedAt.toLocaleString()}`} loading="lazy" className="aspect-video w-full rounded-lg border border-border object-cover" /></a>
            <figcaption className="flex items-center justify-between"><span>{name.get(s.userId)} · {s.capturedAt.toLocaleString()}</span>{s.disputed && <Badge tone="warning">flagged</Badge>}</figcaption>
            {s.disputeNote && <p className="rounded-lg bg-hover p-2">{s.disputeNote}</p>}
            <form action={remove}><input type="hidden" name="id" value={s.id} /><button className="underline text-muted hover:text-brand">Delete</button></form>
          </figure>
        ))}</div>
      )}
    </div>
  );
}
