import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CIRCULAR_KINDS } from "@/lib/circulars";
import { Badge, Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { sendCircularAction } from "./actions";

export const dynamic = "force-dynamic";
const EXTERNAL = ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"];

export default async function Circulars({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("circulars.send");
  const sp = await searchParams;
  const org = user.organizationId;
  const [roles, people, recent] = await Promise.all([
    db.role.findMany({ where: { organizationId: org, key: { notIn: EXTERNAL } }, orderBy: { name: "asc" }, select: { key: true, name: true } }),
    db.user.findMany({ where: { organizationId: org, active: true, userType: "EMPLOYEE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.circular.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 30, include: { recipients: { select: { ackAt: true } } } }),
  ]);
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="Circulars" subtitle="Tell staff about work from home, national day leave, policy changes and so on. Everyone addressed gets a notification (and a phone alert if they use the app) and a popup that stays until they confirm they have read it." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <form action={sendCircularAction} className="card space-y-4">
        <h2 className="font-semibold">New circular</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <div><label htmlFor="title" className="label">Title</label><input id="title" name="title" className="input" maxLength={120} required placeholder="Work from home on Friday" /></div>
          <div><label htmlFor="kind" className="label">Type</label><select id="kind" name="kind" className="input">{Object.entries(CIRCULAR_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div><label htmlFor="body" className="label">Message</label><textarea id="body" name="body" className="input min-h-32" maxLength={4000} required placeholder="Details, dates and what staff need to do." /></div>
        <div><label htmlFor="files" className="label">Attachments (optional)</label><input id="files" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg" className="input" /><p className="mt-1 text-xs text-muted">Up to 3 files: PDF, JPG or PNG, 15 MB each. Staff can open them from the popup and from their notification.</p></div>
        <fieldset className="space-y-3">
          <legend className="label">Send to</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="audience" value="ALL" defaultChecked /> All active staff ({people.length})</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="audience" value="ROLES" /> People with these roles</label>
          <div className="ml-6 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{roles.map((r) => <label key={r.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name="roleKeys" value={r.key} /> {r.name}</label>)}</div>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="audience" value="PEOPLE" /> Chosen people</label>
          <div className="ml-6 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{people.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="userIds" value={p.id} /> {p.name}</label>)}</div>
        </fieldset>
        <SubmitButton pendingText="Sending…">Send circular</SubmitButton>
      </form>
      <section className="card !p-0 overflow-x-auto">
        <h2 className="px-4 pt-4 font-semibold">Sent</h2>
        {recent.length === 0 ? <div className="p-4"><Empty title="Nothing sent yet">Your circulars and who has read them appear here.</Empty></div> : (
          <ul className="mt-2 divide-y divide-border">{recent.map((c) => {
            const done = c.recipients.filter((r) => r.ackAt).length;
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0"><Link href={`/hr/circulars/${c.id}`} className="font-medium hover:underline">{c.title}</Link><p className="text-xs text-muted">{c.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {c.audienceLabel}</p></div>
                <Badge tone={done === c.recipients.length ? "success" : "warning"}>{done} of {c.recipients.length} confirmed</Badge>
              </li>
            );
          })}</ul>
        )}
      </section>
    </div>
  );
}
