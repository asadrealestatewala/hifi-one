import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { STOP_REASONS } from "@/lib/followups";
import { Badge, ConfirmButton, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { setStepsAction, stopEnrollmentAction, toggleSequenceAction, updateSequenceAction } from "../actions";

export const dynamic = "force-dynamic";

const date = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "");

export default async function SequencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; show?: string }> }) {
  const user = await requirePermission("followups.manage");
  const { id } = await params;
  const sp = await searchParams;
  const org = user.organizationId;
  const seq = await db.followUpSequence.findFirst({ where: { id, organizationId: org }, include: { steps: { orderBy: { position: "asc" }, include: { template: { select: { id: true, name: true, subject: true } } } } } });
  if (!seq) notFound();
  const show = ["ACTIVE", "COMPLETED", "STOPPED"].includes(sp.show ?? "") ? sp.show! : "ACTIVE";
  const [templates, mailboxes, sources, enrollments, totals] = await Promise.all([
    db.emailTemplate.findMany({ where: { organizationId: org, kind: "FOLLOW_UP", archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.mailbox.findMany({ where: { organizationId: org, active: true, kind: { in: ["SYSTEM", "SHARED"] } }, orderBy: { address: "asc" }, select: { id: true, address: true, displayName: true } }),
    db.leadSource.findMany({ where: { organizationId: org }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.followUpEnrollment.findMany({ where: { sequenceId: seq.id, status: show }, orderBy: show === "ACTIVE" ? { nextSendAt: "asc" } : { enrolledAt: "desc" }, take: 100, include: { sends: { where: { status: "SENT" }, select: { id: true } } } }),
    db.followUpEnrollment.groupBy({ by: ["status"], where: { sequenceId: seq.id }, _count: true }),
  ]);
  const leads = new Map((await db.lead.findMany({ where: { id: { in: enrollments.map((e) => e.leadId) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  const total = (st: string) => totals.find((t) => t.status === st)?._count ?? 0;
  const rows = [...seq.steps.map((s) => ({ delayDays: s.delayDays, templateId: s.templateId })), { delayDays: (seq.steps.at(-1)?.delayDays ?? -3) + 3, templateId: "" }];
  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/leads/follow-ups" className="text-sm text-muted hover:underline">← All follow-up sequences</Link>
      <PageHeader title={seq.name} subtitle={seq.trigger === "NEW_LEAD" ? `Every new lead with an email${seq.tag ? ` tagged "${seq.tag}"` : ""}${seq.leadSourceId ? " from the chosen website form" : ""} joins automatically while it runs.` : "Leads join when someone adds them from the lead page."}
        actions={(
          <form action={toggleSequenceAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={seq.id} /><input type="hidden" name="active" value={seq.active ? "0" : "1"} />
            {seq.active ? <Badge tone="success">running</Badge> : <Badge>paused</Badge>}
            <SubmitButton className={seq.active ? "btn-ghost" : "btn"} pendingText="Saving…">{seq.active ? "Pause" : "Switch on"}</SubmitButton>
          </form>
        )} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <section className="card space-y-3">
        <div><h2 className="font-semibold">Emails</h2><p className="text-sm text-muted">Days count from the moment the lead joins. Day 0 goes out on the next run after they join. To change the wording, open the template.</p></div>
        {templates.length === 0 && <p className="text-sm text-amber-700">There are no follow-up templates yet. <Link className="underline" href="/leads/follow-ups/templates/new">Write one</Link> first.</p>}
        <form action={setStepsAction} className="space-y-2">
          <input type="hidden" name="id" value={seq.id} />
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="grid items-end gap-2 rounded-xl border border-border p-3 sm:grid-cols-[6rem_1fr_auto]">
                <div><label className="label" htmlFor={`d-${i}`}>{i < seq.steps.length ? `Email ${i + 1}: day` : "Add: day"}</label><input id={`d-${i}`} name="delayDays" type="number" min={0} max={365} step={1} defaultValue={r.delayDays} className="input" /></div>
                <div>
                  <label className="label" htmlFor={`t-${i}`}>Template</label>
                  <select id={`t-${i}`} name="templateId" defaultValue={r.templateId} className="input"><option value="">{i < seq.steps.length ? "Choose a template" : "(none, leave empty)"}</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                </div>
                <div className="flex items-center gap-3 pb-2 text-sm">
                  {r.templateId && <Link className="underline" href={`/leads/follow-ups/templates/${r.templateId}`}>Edit wording</Link>}
                  {i < seq.steps.length && <label className="flex items-center gap-1"><input type="checkbox" name="remove" value={i} /> Remove</label>}
                </div>
              </li>
            ))}
          </ol>
          <SubmitButton pendingText="Saving…">Save emails</SubmitButton>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Settings</h2>
        <form action={updateSequenceAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={seq.id} />
          <div><label className="label" htmlFor="s-name">Name</label><input id="s-name" name="name" className="input" required defaultValue={seq.name} maxLength={120} /></div>
          <div><label className="label" htmlFor="s-trig">Who joins</label><select id="s-trig" name="trigger" className="input" defaultValue={seq.trigger}><option value="NEW_LEAD">Every new lead automatically</option><option value="MANUAL">Only leads added by hand</option></select></div>
          <div><label className="label" htmlFor="s-src">Only leads from this website form</label><select id="s-src" name="leadSourceId" className="input" defaultValue={seq.leadSourceId ?? ""}><option value="">Any source</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="label" htmlFor="s-tag">Only leads with this tag</label><input id="s-tag" name="tag" className="input" defaultValue={seq.tag ?? ""} maxLength={30} placeholder="any tag" /></div>
          <div>
            <label className="label" htmlFor="s-mb">Send from</label>
            <select id="s-mb" name="mailboxId" className="input" defaultValue={seq.mailboxId ?? ""}><option value="">Default sender (MAIL_FROM)</option>{mailboxes.map((m) => <option key={m.id} value={m.id}>{m.displayName} &lt;{m.address}&gt;</option>)}</select>
            <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="fromOwner" defaultChecked={seq.fromOwner} /> Use the lead owner&apos;s own mailbox when they have one</label>
          </div>
          <div className="space-y-2">
            <label className="label" htmlFor="s-desc">Note for the team</label><input id="s-desc" name="description" className="input" defaultValue={seq.description ?? ""} maxLength={500} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stopOnStageChange" defaultChecked={seq.stopOnStageChange} /> Stop when the lead moves to another pipeline stage</label>
          </div>
          <p className="text-xs text-muted sm:col-span-2">Replies reach Hifi One only through company mailboxes with receiving switched on (Settings › Mailboxes). Sending from the owner&apos;s mailbox means the lead&apos;s reply lands in their inbox and stops the sequence.</p>
          <div className="sm:col-span-2"><SubmitButton>Save settings</SubmitButton></div>
        </form>
      </section>

      <section className="card !p-0 overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
          <h2 className="mr-2 font-semibold">Leads</h2>
          {(["ACTIVE", "COMPLETED", "STOPPED"] as const).map((st) => (
            <Link key={st} href={`?show=${st}`} className={`rounded-full px-3 py-1 text-xs ${show === st ? "bg-primary text-white" : "border border-border text-muted"}`}>{st === "ACTIVE" ? "Running" : st === "COMPLETED" ? "Finished" : "Stopped"} ({total(st)})</Link>
          ))}
        </div>
        {enrollments.length === 0 ? <p className="p-4 text-sm text-muted">No leads here.</p> : (
          <table className="mt-2 w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Lead</th><th className="pr-4">Joined (UTC)</th><th className="pr-4">Sent</th><th className="pr-4">{show === "ACTIVE" ? "Next email (UTC)" : show === "STOPPED" ? "Why it stopped" : "Finished"}</th><th className="pr-4"></th></tr></thead>
            <tbody>{enrollments.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`/leads/${e.leadId}`}>{leads.get(e.leadId) ?? "Lead"}</Link><span className="block text-xs text-muted">{e.email}</span></td>
                <td className="pr-4 whitespace-nowrap">{date(e.enrolledAt)}</td>
                <td className="pr-4">{e.sends.length} of {seq.steps.length}</td>
                <td className="pr-4">{show === "ACTIVE" ? <>#{e.nextStep + 1} at {date(e.nextSendAt)}{e.failures > 0 && <span className="block text-xs text-amber-700">{e.failures} failed attempt{e.failures === 1 ? "" : "s"}</span>}</> : show === "STOPPED" ? STOP_REASONS[e.stopReason ?? ""] ?? e.stopReason : `${e.sends.length} email${e.sends.length === 1 ? "" : "s"}`}</td>
                <td className="pr-4">{e.status === "ACTIVE" && (
                  <form action={stopEnrollmentAction}><input type="hidden" name="enrollmentId" value={e.id} /><input type="hidden" name="back" value={`/leads/follow-ups/${seq.id}`} />
                    <ConfirmButton title="Stop the follow-up for this lead?" message="No more emails from this sequence go to them. A stopped sequence cannot be restarted for the same lead." confirmLabel="Stop">Stop</ConfirmButton>
                  </form>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
