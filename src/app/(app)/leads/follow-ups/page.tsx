import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailConfig } from "@/lib/mailer";
import { STOP_REASONS } from "@/lib/followups";
import { Badge, Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { createSequenceAction } from "./actions";

export const dynamic = "force-dynamic";

const ago = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

export default async function FollowUps({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("followups.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [seqs, counts, sentWeek, templates, log] = await Promise.all([
    db.followUpSequence.findMany({ where: { organizationId: org }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { steps: { orderBy: { position: "asc" }, select: { delayDays: true } } } }),
    db.followUpEnrollment.groupBy({ by: ["sequenceId", "status"], where: { organizationId: org }, _count: true }),
    db.followUpSend.groupBy({ by: ["enrollmentId"], where: { status: "SENT", createdAt: { gte: weekAgo }, enrollment: { organizationId: org } }, _count: true }),
    db.emailTemplate.findMany({ where: { organizationId: org, kind: "FOLLOW_UP" }, orderBy: [{ archived: "asc" }, { name: "asc" }], include: { _count: { select: { steps: true } } } }),
    db.followUpSend.findMany({ where: { enrollment: { organizationId: org } }, orderBy: { createdAt: "desc" }, take: 25, include: { enrollment: { select: { leadId: true, email: true, sequence: { select: { name: true } } } } } }),
  ]);
  const n = (id: string, st: string) => counts.find((c) => c.sequenceId === id && c.status === st)?._count ?? 0;
  const leads = new Map((await db.lead.findMany({ where: { id: { in: log.map((l) => l.enrollment.leadId) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  const stopped = await db.followUpEnrollment.findMany({ where: { organizationId: org, status: "STOPPED", stoppedAt: { gte: weekAgo } }, select: { stopReason: true } });
  const auto = process.env.JOBS_AUTORUN === "1";
  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader title="Follow-up sequences" subtitle="Automatic email follow-ups for new CRM leads: a series of timed emails that stops by itself when the lead replies, changes stage, is won or lost, or unsubscribes." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card"><p className="text-xs text-muted">Emails sent in the last 7 days</p><p className="text-2xl font-semibold">{sentWeek.reduce((a, b) => a + b._count, 0)}</p></div>
        <div className="card"><p className="text-xs text-muted">Leads in a running sequence</p><p className="text-2xl font-semibold">{counts.filter((c) => c.status === "ACTIVE").reduce((a, b) => a + b._count, 0)}</p></div>
        <div className="card"><p className="text-xs text-muted">Stopped in the last 7 days</p><p className="text-2xl font-semibold">{stopped.length}</p><p className="text-xs text-muted">{stopped.filter((x) => x.stopReason === "REPLIED").length} replied, {stopped.filter((x) => x.stopReason === "UNSUBSCRIBED").length} unsubscribed</p></div>
      </section>
      {(!mailConfig().transportReady || !auto) && (
        <section className="card space-y-1 text-sm">
          <h2 className="font-semibold">Before the first email goes out</h2>
          {!mailConfig().transportReady && <p className="text-amber-700">Email is not connected, so nothing can be sent yet. Leads stay where they are until it is. See <Link className="underline" href="/settings/email">Settings › Email</Link>.</p>}
          {!auto && <p className="text-muted">The sender runs automatically when the server has <code>JOBS_AUTORUN=1</code> (every 15 minutes). Otherwise schedule <code>npm run followups:run</code> every 5 to 15 minutes, or call <code>POST /api/jobs/run?only=followups</code> with the jobs token.</p>}
        </section>
      )}

      <section className="card !p-0 overflow-x-auto">
        <h2 className="px-4 pt-4 font-semibold">Sequences</h2>
        {seqs.length === 0 ? <div className="p-4"><Empty title="No sequences yet">Create one below. Start with the four ready-made emails (day 0, 2, 5 and 10) and adjust them.</Empty></div> : (
          <table className="mt-2 w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Sequence</th><th className="pr-4">Emails</th><th className="pr-4">Who joins</th><th className="pr-4">Running</th><th className="pr-4">Finished</th><th className="pr-4">Stopped</th><th className="pr-4">Status</th></tr></thead>
            <tbody>{seqs.map((q) => (
              <tr key={q.id} className="border-t border-border hover:bg-hover/50">
                <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`/leads/follow-ups/${q.id}`}>{q.name}</Link>{q.description && <span className="block text-xs text-muted">{q.description}</span>}</td>
                <td className="pr-4">{q.steps.length ? `Day ${q.steps.map((s) => s.delayDays).join(", ")}` : <span className="text-muted">none yet</span>}</td>
                <td className="pr-4">{q.trigger === "NEW_LEAD" ? "Every new lead" : "Added by hand"}{q.tag && <span className="block text-xs text-muted">tag: {q.tag}</span>}</td>
                <td className="pr-4">{n(q.id, "ACTIVE")}</td><td className="pr-4">{n(q.id, "COMPLETED")}</td><td className="pr-4">{n(q.id, "STOPPED")}</td>
                <td className="pr-4">{q.active ? <Badge tone="success">running</Badge> : <Badge>paused</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <form action={createSequenceAction} className="grid gap-3 border-t border-border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <input type="hidden" name="trigger" value="NEW_LEAD" />
          <div><label className="label" htmlFor="seq-name">New sequence</label><input id="seq-name" name="name" className="input" required minLength={2} maxLength={120} placeholder="New lead nurture" /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="starter" defaultChecked /> Start with the 4 ready-made emails</label>
          <SubmitButton pendingText="Creating…">Create sequence</SubmitButton>
        </form>
      </section>

      <section className="card !p-0 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4"><h2 className="font-semibold">Follow-up email templates</h2><Link className="btn-ghost" href="/leads/follow-ups/templates/new">New template</Link></div>
        {templates.length === 0 ? <p className="p-4 text-sm text-muted">Templates appear here once you create a sequence with the ready-made emails, or write your own.</p> : (
          <ul className="mt-2 divide-y divide-border text-sm">{templates.map((t) => (
            <li key={t.id}><Link href={`/leads/follow-ups/templates/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-hover/50">
              <span className="min-w-0"><span className="block font-medium">{t.name}</span><span className="block truncate text-xs text-muted">{t.subject}</span></span>
              <span className="flex gap-2">{t.archived && <Badge>archived</Badge>}<Badge tone={t._count.steps ? "primary" : "neutral"}>{t._count.steps ? `used in ${t._count.steps}` : "not used"}</Badge></span>
            </Link></li>
          ))}</ul>
        )}
      </section>

      <section className="card !p-0 overflow-x-auto">
        <h2 className="px-4 pt-4 font-semibold">Recently sent</h2>
        {log.length === 0 ? <p className="p-4 text-sm text-muted">Nothing sent yet.</p> : (
          <table className="mt-2 w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">When (UTC)</th><th className="pr-4">Lead</th><th className="pr-4">Sequence</th><th className="pr-4">Email</th><th className="pr-4">Result</th></tr></thead>
            <tbody>{log.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-4 py-2 whitespace-nowrap">{ago(l.createdAt)}</td>
                <td className="pr-4"><Link className="hover:underline" href={`/leads/${l.enrollment.leadId}`}>{leads.get(l.enrollment.leadId) ?? l.enrollment.email}</Link><span className="block text-xs text-muted">{l.enrollment.email}</span></td>
                <td className="pr-4">{l.enrollment.sequence.name}</td>
                <td className="pr-4">#{l.position + 1}{l.subject && <span className="block text-xs text-muted">{l.subject}</span>}</td>
                <td className="pr-4">{l.status === "SENT" ? <Badge tone="success">sent</Badge> : <Badge tone="warning">{l.status.toLowerCase()}</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="px-4 py-3 text-xs text-muted">Why sequences stop: {Object.entries(STOP_REASONS).slice(0, 5).map(([, v]) => v.toLowerCase()).join(", ")}. Every email has an unsubscribe link; unsubscribed addresses join the do-not-contact list.</p>
      </section>
    </div>
  );
}
