import Link from "next/link";
import { notFound } from "next/navigation";
import WhatsAppButton from "@/components/WhatsAppButton";
import Icon from "@/components/shell/Icon";
import { Badge, Empty, Notice } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { contactEmailHistory, contactScope, previewMerge, type Entry } from "@/lib/crm-contacts";
import { StatusBadge } from "@/components/ui";
import { leadScore } from "@/lib/crm";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { templates } from "@/lib/whatsapp";
import ContactForm from "../ContactForm";
import ContactMain from "./ContactMain";
import FilesPanel from "@/components/FilesPanel";
import Drawer from "@/components/ui/Drawer";
import { logContactAction, mergeContactsAction, openOpportunityAction, sendContactEmailAction } from "../actions";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;
const TONE: Record<string, "success" | "primary" | "warning" | "neutral"> = { CUSTOMER: "success", LEAD: "primary", PARTNER: "warning", VENDOR: "neutral", INVESTOR: "neutral", OTHER: "neutral" };
const KIND_ICON: Record<string, string> = { NOTE: "file", CALL: "phone", EMAIL: "mail", MEETING: "video", WHATSAPP: "chat", SYSTEM: "sparkles" };
const PALETTE = ["#5648e8", "#0ea5e9", "#059669", "#d97706", "#e11d74", "#8b5cf6", "#0d9488", "#ea580c"];
const hue = (s: string) => PALETTE[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("crm.view");
  const { id } = await params;
  const sp = await searchParams;
  const org = user.organizationId;
  const who = { id: user.id, organizationId: org, permissions: user.permissions };
  const c = await db.contact.findFirst({ where: { AND: [contactScope(who), { id }] } });
  if (!c) notFound();
  const canEdit = user.permissions.has("crm.edit"), manager = user.permissions.has("crm.view_all"), finance = user.permissions.has("finance.view");
  const tab = ["deals", "billing", "people", "email", "projects", "tasks", "documents", "events", "calls"].includes(sp.tab ?? "") ? sp.tab! : "overview";
  const [parent, people, , client, activities, staff] = await Promise.all([
    c.parentId ? db.contact.findUnique({ where: { id: c.parentId }, select: { id: true, name: true } }) : null,
    c.kind === "ORGANIZATION" ? db.contact.findMany({ where: { AND: [contactScope(who), { parentId: c.id, archived: false }] }, orderBy: { name: "asc" }, take: 100 }) : [],
    Promise.resolve([] as never[]),
    db.client.findFirst({ where: { organizationId: org, contactId: c.id } }),
    db.contactActivity.findMany({ where: { contactId: c.id }, orderBy: { createdAt: "desc" }, take: 150 }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const parentFull = c.parentId ? await db.contact.findUnique({ where: { id: c.parentId }, select: { primaryEmail: true, primaryPhone: true } }) : null;
  const leads = await db.lead.findMany({ where: { organizationId: org, contactId: { in: [c.id, ...people.map((p) => p.id)] } }, include: { stage: true }, orderBy: { createdAt: "desc" } });
  const name = new Map(staff.map((s) => [s.id, s.name]));
  const phones = c.phones as unknown as Entry[], emails = c.emails as unknown as Entry[];
  const needBilling = tab === "billing" && finance && client;
  const [invoices, quotes, subs, meetings, stages, orgs, campaigns] = await Promise.all([
    needBilling ? db.invoice.findMany({ where: { clientId: client!.id, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
    needBilling && user.permissions.has("quotes.view") ? db.quote.findMany({ where: { clientId: client!.id }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    needBilling ? db.subscription.findMany({ where: { clientId: client!.id }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    tab === "billing" || tab === "overview" ? db.meeting.findMany({ where: { organizationId: org, OR: [{ contactId: c.id }, ...(client ? [{ clientId: client.id }] : [])], status: { in: ["SCHEDULED", "LIVE"] } }, orderBy: { scheduledAt: "asc" }, take: 5 }) : [],
    canEdit && (tab === "deals" || sp.edit) ? db.pipelineStage.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : [],
    canEdit && sp.edit ? db.contact.findMany({ where: { organizationId: org, kind: "ORGANIZATION", archived: false }, select: { name: true }, orderBy: { name: "asc" }, take: 500 }) : [],
    canEdit && sp.edit ? db.campaign.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const [mailLog, mergeCandidates, mergePrev] = await Promise.all([
    tab === "email" ? contactEmailHistory(db, org, c.id, emails.map((e) => e.value), finance) : [],
    manager && sp.merge && sp.mq?.trim()
      ? db.contact.findMany({ where: { AND: [contactScope(who), { kind: c.kind, archived: false, id: { not: c.id }, OR: [{ name: { contains: sp.mq.trim(), mode: "insensitive" } }, { primaryEmail: { contains: sp.mq.trim(), mode: "insensitive" } }] }] }, orderBy: { name: "asc" }, take: 8, select: { id: true, name: true, primaryEmail: true, primaryPhone: true } })
      : [],
    manager && sp.merge && sp.with ? previewMerge(db, { organizationId: org, intoId: c.id, fromId: sp.with }).catch(() => null) : null,
  ]);
  const orgNames = canEdit && tab === "overview" && c.kind === "PERSON" ? await db.contact.findMany({ where: { organizationId: org, kind: "ORGANIZATION", archived: false }, select: { name: true }, orderBy: { name: "asc" }, take: 500 }) : [];
  const [projects, tasks, events] = await Promise.all([
    (tab === "projects" || tab === "tasks") && client && user.permissions.has("projects.view") ? db.project.findMany({ where: { organizationId: org, clientId: client.id }, orderBy: { createdAt: "desc" }, include: { tasks: { select: { id: true, title: true, status: true, dueDate: true, assigneeId: true, priority: true, parentId: true } } }, take: 50 }) : [],
    Promise.resolve([] as never[]),
    tab === "events" ? db.meeting.findMany({ where: { organizationId: org, OR: [{ contactId: c.id }, ...(client ? [{ clientId: client.id }] : [])] }, orderBy: { scheduledAt: "desc" }, take: 50 }) : [],
  ]);
  void tasks;
  const openLead = leads.find((l) => !l.clientId && !l.stage.isWon && !l.stage.isLost);
  const outstanding = invoices.filter((i) => ["ISSUED", "PARTIALLY_PAID"].includes(i.status)).reduce((a, i) => a + Number(i.total) - Number(i.amountPaid) - Number(i.creditedAmount), 0);
  const tabLinks: [string, string][] = [["overview", "Main"], ["deals", `Opportunities (${leads.length})`], ...(c.kind === "ORGANIZATION" ? [["people", `People (${people.length})`] as [string, string]] : []), ["projects", "Projects"], ["tasks", "Tasks"], ["documents", "Documents"], ...(finance ? [["billing", "Payments"] as [string, string]] : []), ["events", "Events"], ...(emails.length > 0 ? [["email", "Email"] as [string, string]] : []), ["calls", "Calls"]];
  const wa = phones.find((p) => p.type === "WHATSAPP") ?? phones[0];

  return (
    <div className="space-y-6">
      <Link href="/contacts" className="text-sm text-muted hover:underline">← Contacts</Link>
      {sp.created && <div className="pop rounded-2xl bg-gradient-to-r from-primary to-accent px-5 py-3 text-white shadow-md"><strong>Contact added!</strong> <span className="text-white/85">+10 XP. It is already visible to your pipeline, leads and reports{leads.length ? ", and an opportunity is open for it" : ""}.</span></div>}
      {sp.saved && <Notice kind="ok">Saved. Linked leads and the client account were updated too.</Notice>}
      {sp.logged && <Notice kind="ok">Logged. It also appears on the linked lead. +5 XP</Notice>}
      {sp.opened && <Notice kind="ok">Opportunity opened. You can move it on the Opportunities board.</Notice>}
      {sp.merged && <Notice kind="ok">Merged. Leads, activity, tags and details from the duplicate are now on this contact, and the duplicate is archived.</Notice>}
      {sp.sent && <Notice kind="ok">Email sent and logged on the timeline.</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <header className="card flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white shadow-md" style={{ background: `linear-gradient(135deg, ${hue(c.name)}, color-mix(in srgb, ${hue(c.name)} 55%, #fff))` }}>{c.kind === "ORGANIZATION" ? <Icon name="building" className="h-7 w-7" /> : initials(c.name)}</span>
          <div className="space-y-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{[c.title, c.name].filter(Boolean).join(" ")}<Badge tone={TONE[c.category] ?? "neutral"}>{c.category.toLowerCase()}</Badge>{c.archived && <Badge tone="danger">archived</Badge>}</h1>
            <p className="text-sm text-muted">{c.jobTitle}{c.jobTitle && parent && " at "}{parent && <Link href={`/contacts/${parent.id}`} className="font-medium text-foreground hover:underline">{parent.name}</Link>}{!c.jobTitle && !parent && (c.kind === "ORGANIZATION" ? c.industry ?? "Organization" : "Contact")}</p>
            <p className="text-xs text-muted">Owner {c.ownerId ? name.get(c.ownerId) ?? "Unknown" : "not set"}{c.followers.length > 0 && ` · ${c.followers.length} follower${c.followers.length === 1 ? "" : "s"}`} · added {c.createdAt.toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phones[0] && <a href={`tel:${phones[0].value.replace(/[^\d+]/g, "")}`} className="btn-ghost"><Icon name="phone" className="h-4 w-4" />Call</a>}
          {emails[0] && <a href={`mailto:${emails[0].value}`} className="btn-ghost"><Icon name="mail" className="h-4 w-4" />Email</a>}
          {wa && canEdit && <WhatsAppButton phone={wa.value} text={templates.leadFollowUp(c.name, user.name, "Hifi Marketing and Technologies")} label="WhatsApp" />}
          {user.permissions.has("meetings.use") && <Link href="/meetings" className="btn-ghost"><Icon name="video" className="h-4 w-4" />Meeting</Link>}
          {manager && !c.archived && <Link href={`/contacts/${c.id}?merge=1`} className="btn-ghost">Merge duplicate</Link>}
          {canEdit && <Link href={`/contacts/${c.id}?edit=1`} className="btn">Edit</Link>}
        </div>
      </header>

      <div className="rounded-2xl border border-border bg-surface px-4 py-2.5 text-xs text-muted">
        <span className="font-medium text-foreground">Synced with:</span>{" "}
        {leads.length === 0 && !client ? "no lead or client account yet" : <>
          {leads.map((l) => <Link key={l.id} href={`/leads/${l.id}`} className="mr-2 underline">Lead L-{l.number} ({l.stage.name})</Link>)}
          {client && <Link href={`/clients/${client.id}`} className="underline">Client {client.code}</Link>}
        </>}
        <span className="ml-2">· edits here update them, and edits there update this record.</span>
      </div>

      <nav aria-label="Contact sections" className="flex gap-1 overflow-x-auto rounded-xl bg-hover p-1 text-sm">
        {tabLinks.map(([k, label]) => <Link key={k} href={`/contacts/${c.id}${k === "overview" ? "" : `?tab=${k}`}`} aria-current={tab === k ? "page" : undefined} className={`whitespace-nowrap rounded-lg px-4 py-1.5 font-medium transition ${tab === k ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}>{label}</Link>)}
      </nav>

      {tab === "overview" && (
        <ContactMain c={c} parent={parent ? { ...parent, primaryEmail: parentFull?.primaryEmail ?? null, primaryPhone: parentFull?.primaryPhone ?? null } : null} people={people.length} staff={staff} owners={name}
          followerNames={c.followers.map((f) => ({ id: f, name: name.get(f) ?? "Former staff" }))} orgs={orgNames.map((o) => o.name)} canEdit={canEdit} manager={manager}
          right={<div className="space-y-6"><Timeline c={c} canEdit={canEdit} activities={activities.slice(0, 30)} names={name} showAll />{meetings.length > 0 && <section className="card space-y-2"><h2 className="font-semibold">Upcoming meetings</h2><ul className="text-sm">{meetings.map((m) => <li key={m.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><Link className="hover:underline" href={`/meetings/${m.id}`}>{m.title}</Link><span className="text-muted">{m.scheduledAt?.toLocaleString() ?? "now"}</span></li>)}</ul></section>}</div>} />
      )}

      {tab === "deals" && (
        <div className="space-y-4">
          {leads.length === 0 ? <Empty title="No opportunities yet">Open one to put this contact on the pipeline board.</Empty> : leads.map((l) => {
            const sc = leadScore(l);
            return (
              <Link key={l.id} href={`/leads/${l.id}`} className="card flex flex-wrap items-center justify-between gap-3 hover:border-primary/40">
                <div><p className="font-medium">L-{l.number} · {l.serviceInterest ?? "Opportunity"}</p><p className="text-xs text-muted">Opened {l.createdAt.toLocaleDateString()}{l.nextFollowUp && ` · follow-up ${l.nextFollowUp.toLocaleDateString()}`}</p></div>
                <div className="flex items-center gap-3"><span className="font-medium">{l.dealValue ? formatMoney(l.dealValue, l.currency) : ""}</span><Badge tone={l.clientId ? "success" : "primary"}>{l.clientId ? "won" : l.stage.name}</Badge><Badge tone={sc.score >= 60 ? "success" : sc.score >= 30 ? "warning" : "neutral"}>score {sc.score}</Badge></div>
              </Link>
            );
          })}
          {canEdit && !openLead && (
            <form action={openOpportunityAction} className="card grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="contactId" value={c.id} /><h2 className="font-semibold sm:col-span-4">Open an opportunity</h2>
              <div><label className="label" htmlFor="o-v">Expected value</label><input id="o-v" name="dealValue" inputMode="decimal" className="input" /></div>
              <div><label className="label" htmlFor="o-c">Currency</label><select id="o-c" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><label className="label" htmlFor="o-s">Service</label><input id="o-s" name="serviceInterest" className="input" /></div>
              <div><label className="label" htmlFor="o-st">Stage</label><select id="o-st" name="stageId" className="input" defaultValue=""><option value="">First stage</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="sm:col-span-4"><button className="btn">Open on the pipeline</button></div>
            </form>
          )}
        </div>
      )}

      {tab === "people" && (people.length === 0 ? <Empty title="No people linked">Add a contact and choose this organization as their company.</Empty> : (
        <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="text-left"><tr><th className="px-4 py-3">Name</th><th className="pr-4">Job title</th><th className="pr-4">Email</th><th className="pr-4">Category</th></tr></thead>
          <tbody>{people.map((p) => <tr key={p.id} className="border-t border-border transition hover:bg-hover/50"><td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/contacts/${p.id}`}>{p.name}</Link></td><td className="pr-4">{p.jobTitle}</td><td className="pr-4">{p.primaryEmail}</td><td className="pr-4"><Badge tone={TONE[p.category] ?? "neutral"}>{p.category.toLowerCase()}</Badge></td></tr>)}</tbody></table></div>
      ))}

      {tab === "projects" && (!client ? <Empty title="No client account yet">Projects appear here once this contact has a client account.</Empty> : !user.permissions.has("projects.view") ? <Empty title="Restricted">You do not have access to projects.</Empty> : projects.length === 0 ? <Empty title="No projects">Projects created for {client.name} will show up here.</Empty> : (
        <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Project</th><th className="pr-4">Status</th><th className="pr-4">Deadline</th><th className="pr-4">Tasks done</th></tr></thead>
          <tbody>{projects.map((pr) => { const top = pr.tasks.filter((t) => !t.parentId), done = top.filter((t) => t.status === "DONE").length; return <tr key={pr.id} className="border-t border-border transition hover:bg-hover/50"><td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/projects/${pr.id}`}>{pr.name}</Link><span className="block text-xs text-muted">{pr.number}</span></td><td className="pr-4"><StatusBadge status={pr.status} /></td><td className="pr-4 text-muted">{pr.deadline?.toLocaleDateString() ?? ""}</td><td className="pr-4">{done} / {top.length}</td></tr>; })}</tbody></table></div>
      ))}

      {tab === "tasks" && (!client ? <Empty title="No client account yet">Tasks appear here once this contact has a client account.</Empty> : !user.permissions.has("projects.view") ? <Empty title="Restricted">You do not have access to projects.</Empty> : projects.flatMap((pr) => pr.tasks.map((t) => ({ ...t, project: pr }))).length === 0 ? <Empty title="No tasks">Tasks on this client&apos;s projects will show up here.</Empty> : (
        <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Task</th><th className="pr-4">Project</th><th className="pr-4">Status</th><th className="pr-4">Due</th><th className="pr-4">Assignee</th></tr></thead>
          <tbody>{projects.flatMap((pr) => pr.tasks.map((t) => ({ ...t, project: pr }))).sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity)).map((t) => <tr key={t.id} className="border-t border-border transition hover:bg-hover/50"><td className="px-4 py-2.5 font-medium">{t.title}</td><td className="pr-4"><Link className="hover:underline" href={`/projects/${t.project.id}`}>{t.project.name}</Link></td><td className="pr-4"><StatusBadge status={t.status} /></td><td className={`pr-4 ${t.status !== "DONE" && t.dueDate && t.dueDate < new Date() ? "text-brand" : "text-muted"}`}>{t.dueDate?.toLocaleDateString() ?? ""}</td><td className="pr-4 text-muted">{t.assigneeId ? name.get(t.assigneeId) ?? "" : ""}</td></tr>)}</tbody></table></div>
      ))}

      {tab === "documents" && <FilesPanel user={user} ownerType="CONTACT" ownerId={c.id} returnTo={`/contacts/${c.id}?tab=documents`} title="Documents and attachments" withCategory flash={{ fileError: sp.fileError, fileOk: sp.fileOk }} />}

      {tab === "events" && (events.length === 0 ? <Empty title="No meetings or events">Meetings you schedule with this contact, or their client, appear here.</Empty> : (
        <ul className="card divide-y divide-border text-sm">{events.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"><span><Link className="font-medium hover:underline" href={`/meetings/${m.id}`}>{m.title}</Link><span className="block text-xs text-muted">{m.kind.toLowerCase()} · {m.scheduledAt ? m.scheduledAt.toLocaleString() : "unscheduled"}</span></span><StatusBadge status={m.status} /></li>)}</ul>
      ))}

      {tab === "calls" && (() => {
        const calls = activities.filter((a) => a.kind === "CALL");
        return calls.length === 0 ? <Empty title="No calls logged">Log a call from the Main tab and it is listed here with its outcome.</Empty> : (
          <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">When</th><th className="pr-4">Outcome</th><th className="pr-4">By</th><th className="pr-4">Notes</th></tr></thead>
            <tbody>{calls.map((a) => <tr key={a.id} className="border-t border-border transition hover:bg-hover/50"><td className="px-4 py-2.5 whitespace-nowrap">{a.createdAt.toLocaleString()}</td><td className="pr-4">{a.outcome ? <StatusBadge status={a.outcome === "CONNECTED" ? "ACTIVE" : a.outcome === "NOT_INTERESTED" || a.outcome === "WRONG_NUMBER" ? "REJECTED" : "PENDING"} /> : null} <span className="text-xs text-muted">{a.outcome?.toLowerCase().replace("_", " ")}</span></td><td className="pr-4 text-muted">{a.actorId ? name.get(a.actorId) ?? "" : ""}</td><td className="pr-4">{a.body}</td></tr>)}</tbody></table></div>
        );
      })()}

      {tab === "email" && (
        <section className="card space-y-4">
          <h2 className="font-semibold">Email</h2>
          {canEdit ? (
            <form action={sendContactEmailAction} className="grid gap-3 rounded-2xl bg-hover p-4">
              <input type="hidden" name="contactId" value={c.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="mto">To</label><select id="mto" name="to" className="input">{emails.map((e) => <option key={e.value} value={e.value}>{e.value}</option>)}</select></div>
                <div><label className="label" htmlFor="msub">Subject</label><input id="msub" name="subject" required maxLength={200} className="input" /></div>
              </div>
              <div><label className="label" htmlFor="mbody">Message</label><textarea id="mbody" name="body" required rows={6} maxLength={20000} className="input" /></div>
              <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted">Sent from the company mail account. If none is connected, nothing is sent and the attempt is recorded below.</p><button className="btn">Send</button></div>
            </form>
          ) : null}
          {mailLog.length === 0 ? <p className="text-sm text-muted">No emails sent to this contact from here yet.</p> : (
            <ul className="divide-y divide-border text-sm">
              {mailLog.map((m) => (
                <li key={m.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{m.subject}</span><StatusBadge status={m.status === "NOT_CONFIGURED" ? "PENDING" : m.status === "FAILED" ? "REJECTED" : "SENT"} /></div>
                  <p className="text-xs text-muted">To {m.toEmail} · {m.createdAt.toLocaleString()}{m.status === "NOT_CONFIGURED" && " · not sent, no mail account connected"}{m.status === "FAILED" && ` · failed: ${m.error ?? ""}`}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "billing" && (!finance ? <Empty title="Billing is restricted">You do not have access to financial records.</Empty> : !client ? <Empty title="No client account yet">When an opportunity is won, the client account, invoices and statements show up here.</Empty> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card !p-4"><p className="text-xs font-medium text-muted">Client account</p><Link className="mt-1 block text-lg font-semibold hover:underline" href={`/clients/${client.id}`}>{client.code} · {client.name}</Link></div>
            <div className="card !p-4"><p className="text-xs font-medium text-muted">Outstanding</p><p className="mt-1 text-2xl font-semibold">{formatMoney(outstanding, client.currency)}</p></div>
            <div className="card !p-4"><p className="text-xs font-medium text-muted">Invoices</p><p className="mt-1 text-2xl font-semibold">{invoices.length}</p></div>
          </div>
          <section className="card overflow-x-auto"><h2 className="mb-2 font-semibold">Invoices</h2>{invoices.length === 0 ? <p className="text-sm text-muted">No issued invoices.</p> : <table className="w-full text-sm"><tbody>{invoices.map((i) => <tr key={i.id} className="border-t border-border first:border-0"><td className="py-2 pr-4"><Link className="hover:underline" href={`/finance/invoices/${i.id}`}>{i.number}</Link></td><td className="pr-4">{i.status.toLowerCase().replace("_", " ")}</td><td className="text-right">{formatMoney(i.total, i.currency)}</td></tr>)}</tbody></table>}</section>
          {quotes.length > 0 && <section className="card"><h2 className="mb-2 font-semibold">Quotations</h2><ul className="text-sm">{quotes.map((q) => <li key={q.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><Link className="hover:underline" href={`/quotes/${q.id}`}>{q.number}</Link><span>{q.status.toLowerCase()} · {formatMoney(q.total, q.currency)}</span></li>)}</ul></section>}
          {subs.length > 0 && <section className="card"><h2 className="mb-2 font-semibold">Subscriptions</h2><ul className="text-sm">{subs.map((s) => <li key={s.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><span>{s.name}</span><span>{s.status.toLowerCase()} · {formatMoney(s.amount, s.currency)} {s.interval.toLowerCase()}</span></li>)}</ul></section>}
        </div>
      ))}

      {manager && sp.merge && (
        <Drawer title={`Merge into ${c.name}`} closeTo={`/contacts/${c.id}`}>
          <div className="h-full space-y-4 overflow-y-auto p-5 text-sm">
            <p className="text-muted">Keep this contact and fold a duplicate into it. Leads, the client link, activity, people, tags, phones and emails move over; the duplicate is archived, not deleted.</p>
            <form className="flex gap-2" role="search"><input type="hidden" name="merge" value="1" /><input name="mq" defaultValue={sp.mq} placeholder="Find the duplicate by name or email" aria-label="Find the duplicate" className="input flex-1" /><button className="btn-ghost">Search</button></form>
            {sp.mq && mergeCandidates.length === 0 && <p className="text-muted">No other {c.kind === "ORGANIZATION" ? "organizations" : "people"} match.</p>}
            <ul className="divide-y divide-border">
              {mergeCandidates.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2"><span><span className="font-medium">{m.name}</span><span className="block text-xs text-muted">{m.primaryEmail ?? m.primaryPhone ?? "no email or phone"}</span></span><Link className="btn-ghost" href={`/contacts/${c.id}?merge=1&mq=${encodeURIComponent(sp.mq ?? "")}&with=${m.id}`}>Preview</Link></li>
              ))}
            </ul>
            {mergePrev && (
              <form action={mergeContactsAction} className="space-y-3 rounded-2xl border border-border bg-hover p-4">
                <input type="hidden" name="intoId" value={c.id} /><input type="hidden" name="fromId" value={mergePrev.from.id} />
                <p><strong>{mergePrev.from.name}</strong> will be merged into <strong>{mergePrev.into.name}</strong>:</p>
                <ul className="list-disc pl-5 text-muted">
                  <li>{mergePrev.moves.leads} lead{mergePrev.moves.leads === 1 ? "" : "s"} and {mergePrev.moves.activities} timeline entr{mergePrev.moves.activities === 1 ? "y" : "ies"} move over</li>
                  {mergePrev.moves.people > 0 && <li>{mergePrev.moves.people} linked {mergePrev.moves.people === 1 ? "person" : "people"} move over</li>}
                  {mergePrev.moves.client && <li>its client account is re-linked to this contact</li>}
                  <li>{mergePrev.moves.phones} new phone, {mergePrev.moves.emails} new email, {mergePrev.moves.tags} new tag</li>
                  <li>blank fields here are filled from it; fields you already have are kept</li>
                </ul>
                <div className="flex justify-end gap-2"><Link href={`/contacts/${c.id}?merge=1&mq=${encodeURIComponent(sp.mq ?? "")}`} className="btn-ghost">Back</Link><button className="btn">Merge and archive duplicate</button></div>
              </form>
            )}
            {sp.with && !mergePrev && <Notice kind="error">That pair cannot be merged. They must be the same kind, and only one of them may have a client account.</Notice>}
          </div>
        </Drawer>
      )}

      {canEdit && sp.edit && (
        <Drawer title={`Edit ${c.name}`} closeTo={`/contacts/${c.id}`}>
          <ContactForm mode="edit" staff={staff} orgs={orgs.map((o) => o.name)} campaigns={campaigns} stages={stages} me={user.id} canAssign={manager}
            initial={{ id: c.id, kind: c.kind as "PERSON" | "ORGANIZATION", title: c.title, firstName: c.firstName, lastName: c.lastName, name: c.kind === "ORGANIZATION" ? c.name : null, parentName: parent?.name ?? null, category: c.category, industry: c.industry, jobTitle: c.jobTitle,
              ownerId: c.ownerId, followers: c.followers, website: c.website, phones, emails, addressLine: c.addressLine, city: c.city, state: c.state, country: c.country, postalCode: c.postalCode, timezone: c.timezone, preferredContact: c.preferredContact,
              source: c.source, campaignId: c.campaignId, tags: c.tags, notes: c.notes, customFields: c.customFields as Record<string, string>,
              birthday: c.birthday, taxId: c.taxId, shipAddressLine: c.shipAddressLine, shipCity: c.shipCity, shipState: c.shipState, shipCountry: c.shipCountry, shipPostalCode: c.shipPostalCode, social: c.social as Record<string, string>, utm: c.utm as Record<string, string> }} />
        </Drawer>
      )}
    </div>
  );
}

function Timeline({ c, canEdit, activities, names, showAll }: { c: { id: string; name: string }; canEdit: boolean; activities: { id: string; kind: string; outcome: string | null; body: string | null; actorId: string | null; createdAt: Date }[]; names: Map<string, string>; showAll?: boolean }) {
  return (
    <section className="card space-y-4">
      <h2 className="font-semibold">Activity</h2>
      {canEdit && (
        <form action={logContactAction} className="flex flex-wrap items-center gap-2 rounded-2xl bg-hover p-3">
          <input type="hidden" name="contactId" value={c.id} />
          <select name="kind" aria-label="What happened" className="input !w-32" defaultValue="NOTE">{[["NOTE", "Note"], ["CALL", "Call"], ["EMAIL", "Email"], ["MEETING", "Meeting"], ["WHATSAPP", "WhatsApp"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select name="outcome" aria-label="Call outcome" className="input !w-36" defaultValue=""><option value="">(calls only)</option>{["NO_ANSWER", "VOICEMAIL", "CONNECTED", "WRONG_NUMBER", "NOT_INTERESTED"].map((o) => <option key={o} value={o}>{o.toLowerCase().replace("_", " ")}</option>)}</select>
          <input name="body" maxLength={2000} placeholder="What happened?" aria-label="Notes" className="input min-w-48 flex-1" />
          <button className="btn">Log</button>
        </form>
      )}
      {activities.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
        <ol className="relative space-y-4 border-l border-border pl-6">
          {activities.map((a) => (
            <li key={a.id} className="relative text-sm">
              <span className="absolute -left-[34px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-primary"><Icon name={KIND_ICON[a.kind] ?? "file"} className="h-3 w-3" /></span>
              <p className="text-xs text-muted"><span className="font-medium text-foreground">{a.kind === "SYSTEM" ? "System" : a.kind.charAt(0) + a.kind.slice(1).toLowerCase()}</span>{a.outcome && ` · ${a.outcome.toLowerCase().replace("_", " ")}`} · {a.actorId ? names.get(a.actorId) ?? "Someone" : "Automatic"} · {a.createdAt.toLocaleString()}</p>
              {a.body && <p className="mt-0.5 whitespace-pre-wrap">{a.body}</p>}
            </li>
          ))}
        </ol>
      )}
      {showAll && activities.length >= 12 && <Link href={`/contacts/${c.id}?tab=activity`} className="text-sm text-primary underline">See all activity</Link>}
    </section>
  );
}
