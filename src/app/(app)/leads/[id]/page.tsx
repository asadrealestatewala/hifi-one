import Link from "next/link";
import { notFound } from "next/navigation";
import WhatsAppButton from "@/components/WhatsAppButton";
import { Badge, Notice } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { ACTIVITY_KINDS, CALL_OUTCOMES, leadScore } from "@/lib/crm";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/leads";
import { formatMoney } from "@/lib/money";
import { templates } from "@/lib/whatsapp";
import { addNote } from "../actions";
import { logActivityAction, updateLeadDetails } from "../crm-actions";
import StageSelect from "./StageSelect";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { CALL: "Call", EMAIL: "Email", MEETING: "Meeting", FOLLOW_UP: "Follow-up", PROPOSAL: "Proposal", APPOINTMENT: "Appointment", WHATSAPP: "WhatsApp", NOTE: "Note", STAGE_CHANGE: "Stage change", CREATED: "Created" };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await requirePermission("crm.view");
  const { id } = await params;
  const sp = await searchParams;
  const lead = await db.lead.findFirst({ where: { id, ...leadScope(user) }, include: { stage: true, activities: { orderBy: { createdAt: "desc" }, take: 100 } } });
  if (!lead) notFound();
  const org = user.organizationId;
  const manager = user.permissions.has("crm.view_all");
  const [stages, campaigns, agents] = await Promise.all([
    db.pipelineStage.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" } }),
    db.campaign.findMany({ where: { organizationId: org }, orderBy: { name: "asc" } }),
    manager ? db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const canEdit = user.permissions.has("crm.edit");
  const campaign = campaigns.find((c) => c.id === lead.campaignId);
  const owner = lead.assignedToId ? await db.user.findUnique({ where: { id: lead.assignedToId }, select: { name: true } }) : null;
  const actors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(lead.activities.map((a) => a.actorId).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const sc = leadScore(lead);
  const rows: [string, React.ReactNode][] = [
    ["Company", lead.company], ["Email", lead.email], ["Phone", lead.phone], ["Preferred contact", lead.preferredContact?.toLowerCase()],
    ["Location", [lead.city, lead.country].filter(Boolean).join(", ") || null], ["Time zone", lead.timezone], ["Owner", owner?.name], ["Campaign", campaign?.name], ["Source", lead.source],
    ["Service interest", lead.serviceInterest], ["Expected value", lead.dealValue ? formatMoney(lead.dealValue, lead.currency) : null], ["Probability", `${lead.stage.probability}% (from stage)`],
    ["Expected closing", lead.expectedCloseDate], ["Next follow-up", lead.nextFollowUp?.toLocaleDateString()], ["Last contact", lead.lastContactAt?.toLocaleDateString() ?? "never"],
    ["Tags", lead.tags.length ? lead.tags.map((t) => <span key={t} className="mr-1"><Badge tone="primary">{t}</Badge></span>) : null],
  ];
  const overdue = lead.nextFollowUp && lead.nextFollowUp < new Date();
  return (
    <div className="space-y-6">
      <Link href="/leads" className="text-sm text-muted hover:underline">← All leads</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{lead.name}<span className="text-base font-normal text-muted">L-{lead.number}</span><Badge tone="primary">{lead.stage.name}</Badge></h1>
          <p className="mt-1 text-sm text-muted">{lead.company}{overdue && <span className="ml-2"><Badge tone="danger">follow-up overdue</Badge></span>}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {lead.phone && canEdit && <WhatsAppButton phone={lead.phone} text={templates.leadFollowUp(lead.name, user.name, "Hifi Marketing and Technologies")} />}
          {canEdit && <StageSelect leadId={lead.id} current={lead.stageId} stages={stages.map((s) => ({ id: s.id, name: s.name }))} />}
        </div>
      </div>
      <ol className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1.5 text-xs" aria-label="Pipeline stage">
        {stages.filter((st) => !st.isLost || st.id === lead.stageId).map((st) => {
          const idx = stages.findIndex((x) => x.id === st.id), cur = stages.findIndex((x) => x.id === lead.stageId);
          const state = st.id === lead.stageId ? "now" : idx < cur ? "done" : "todo";
          return <li key={st.id} aria-current={state === "now" ? "step" : undefined} className={`flex-1 whitespace-nowrap rounded-xl px-3 py-1.5 text-center font-medium transition ${state === "now" ? (st.isLost ? "bg-brand text-white shadow" : "bg-primary text-white shadow") : state === "done" ? "bg-primary/10 text-primary" : "text-muted"}`}>{state === "done" ? "✓ " : ""}{st.name}</li>;
        })}
      </ol>
      {(lead.phone || lead.email || lead.contactId) && (
        <div className="flex flex-wrap gap-2">
          {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="btn-ghost">Call</a>}
          {lead.email && <a href={`mailto:${lead.email}`} className="btn-ghost">Email</a>}
          {lead.contactId && <Link href={`/contacts/${lead.contactId}`} className="btn-ghost">Open contact</Link>}
        </div>
      )}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.saved && <Notice kind="ok">Saved.</Notice>}
      {lead.clientId && <Notice kind="ok">Converted to a client. <Link className="underline" href={`/clients/${lead.clientId}`}>Open the client account</Link></Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <section className="card space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Details</h2>
              <details className="group relative"><summary className="cursor-pointer list-none"><Badge tone={sc.score >= 60 ? "success" : sc.score >= 30 ? "warning" : "neutral"}>Score {sc.score}</Badge></summary>
                <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-border bg-surface p-3 text-xs shadow-lg"><p className="mb-1 font-semibold">Why this score</p><ul className="space-y-0.5">{sc.reasons.map((r) => <li key={r}>{r}</li>)}</ul><p className="mt-2 text-muted">Rule-based and visible. It orders follow-ups; it is not a judgement of the person.</p></div></details>
            </div>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v ?? <span className="text-muted">—</span>}</dd></div>)}
            </dl>
          </section>

          {canEdit && (
            <details className="card">
              <summary className="cursor-pointer text-sm font-semibold">Edit details</summary>
              <form action={updateLeadDetails} className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="leadId" value={lead.id} />
                {([["company", "Company", lead.company], ["city", "City", lead.city], ["country", "Country", lead.country], ["timezone", "Time zone (e.g. Asia/Karachi)", lead.timezone], ["source", "Source", lead.source], ["serviceInterest", "Service interest", lead.serviceInterest], ["dealValue", "Expected value", lead.dealValue?.toString()]] as [string, string, string | null | undefined][]).map(([n, l, v]) => (
                  <div key={n}><label className="label" htmlFor={`e-${n}`}>{l}</label><input id={`e-${n}`} name={n} defaultValue={v ?? ""} className="input" /></div>
                ))}
                <div><label className="label" htmlFor="e-pc">Preferred contact</label><select id="e-pc" name="preferredContact" defaultValue={lead.preferredContact ?? ""} className="input"><option value="">No preference</option>{["CALL", "WHATSAPP", "EMAIL", "SMS"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select></div>
                <div><label className="label" htmlFor="e-pr">Priority</label><select id="e-pr" name="priority" defaultValue={lead.priority} className="input">{["LOW", "MEDIUM", "HIGH"].map((c) => <option key={c}>{c}</option>)}</select></div>
                <div><label className="label" htmlFor="e-ec">Expected closing date</label><input id="e-ec" name="expectedCloseDate" type="date" defaultValue={lead.expectedCloseDate ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="e-ca">Campaign</label><select id="e-ca" name="campaignId" defaultValue={lead.campaignId ?? ""} className="input"><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div><label className="label" htmlFor="e-ow">Owner</label>{manager ? <select id="e-ow" name="assignedToId" defaultValue={lead.assignedToId ?? ""} className="input"><option value="">Unassigned</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select> : <><input type="hidden" name="assignedToId" value={lead.assignedToId ?? ""} /><input readOnly value={owner?.name ?? "Unassigned"} className="input" aria-label="Owner" /></>}</div>
                <div><label className="label" htmlFor="e-tags">Tags (comma separated)</label><input id="e-tags" name="tags" defaultValue={lead.tags.join(", ")} className="input" /></div>
                <div className="sm:col-span-2"><button className="btn">Save details</button></div>
              </form>
            </details>
          )}
        </div>

        <div className="space-y-6">
          {canEdit && (
            <section className="card space-y-3">
              <h2 className="font-semibold">Log an activity</h2>
              <form action={logActivityAction} className="grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="leadId" value={lead.id} />
                <div><label className="label" htmlFor="a-kind">What happened</label><select id="a-kind" name="kind" className="input" defaultValue="CALL">{ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
                <div><label className="label" htmlFor="a-out">Call outcome</label><select id="a-out" name="outcome" className="input" defaultValue=""><option value="">(only for calls)</option>{CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o.toLowerCase().replace("_", " ")}</option>)}</select></div>
                <div><label className="label" htmlFor="a-fu">Next follow-up</label><input id="a-fu" name="nextFollowUp" type="date" className="input" /></div>
                <div className="sm:col-span-3"><label className="label" htmlFor="a-body">Notes</label><input id="a-body" name="body" maxLength={2000} className="input" placeholder="What was discussed?" /></div>
                <div className="sm:col-span-3"><button className="btn">Log activity</button></div>
              </form>
              <p className="text-xs text-muted">A call marked connected counts toward your target once a manager verifies it.</p>
            </section>
          )}
          <section className="card space-y-3">
            <h2 className="font-semibold">Timeline</h2>
            {canEdit && (
              <form action={addNote} className="flex gap-2"><input type="hidden" name="leadId" value={lead.id} /><input name="body" required placeholder="Add a quick note" className="input" aria-label="Note" /><button className="btn-ghost">Add</button></form>
            )}
            <ol className="relative space-y-4 border-l border-border pl-5 text-sm">
              {lead.activities.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                  <p className="text-xs text-muted">{a.createdAt.toLocaleString()} · <span className="font-medium text-foreground">{KIND_LABEL[a.kind] ?? a.kind}</span>{a.outcome && ` · ${a.outcome.toLowerCase().replace("_", " ")}`}{a.outcome === "CONNECTED" && <span className="ml-1"><Badge tone={a.verified ? "success" : "warning"}>{a.verified ? "verified" : "not yet verified"}</Badge></span>}{a.actorId && actors.get(a.actorId) && ` · ${actors.get(a.actorId)}`}</p>
                  {a.body && <p className="mt-0.5">{a.body}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
