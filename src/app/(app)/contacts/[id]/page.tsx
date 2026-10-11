import Link from "next/link";
import { notFound } from "next/navigation";
import WhatsAppButton from "@/components/WhatsAppButton";
import Icon from "@/components/shell/Icon";
import { Badge, Empty, Notice } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { contactScope, type Entry } from "@/lib/crm-contacts";
import { leadScore } from "@/lib/crm";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { templates } from "@/lib/whatsapp";
import ContactForm from "../ContactForm";
import Drawer from "../Drawer";
import { logContactAction, openOpportunityAction } from "../actions";

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
  const tab = ["activity", "deals", "billing", "people"].includes(sp.tab ?? "") ? sp.tab! : "overview";
  const [parent, people, , client, activities, staff] = await Promise.all([
    c.parentId ? db.contact.findUnique({ where: { id: c.parentId }, select: { id: true, name: true } }) : null,
    c.kind === "ORGANIZATION" ? db.contact.findMany({ where: { AND: [contactScope(who), { parentId: c.id, archived: false }] }, orderBy: { name: "asc" }, take: 100 }) : [],
    Promise.resolve([] as never[]),
    db.client.findFirst({ where: { organizationId: org, contactId: c.id } }),
    db.contactActivity.findMany({ where: { contactId: c.id }, orderBy: { createdAt: "desc" }, take: 150 }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
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
  const openLead = leads.find((l) => !l.clientId && !l.stage.isWon && !l.stage.isLost);
  const outstanding = invoices.filter((i) => ["ISSUED", "PARTIALLY_PAID"].includes(i.status)).reduce((a, i) => a + Number(i.total) - Number(i.amountPaid) - Number(i.creditedAmount), 0);
  const tabLinks: [string, string][] = [["overview", "Overview"], ["activity", `Activity (${activities.filter((a) => a.kind !== "SYSTEM").length})`], ["deals", `Deals (${leads.length})`], ...(c.kind === "ORGANIZATION" ? [["people", `People (${people.length})`] as [string, string]] : []), ...(finance ? [["billing", "Billing"] as [string, string]] : [])];
  const wa = phones.find((p) => p.type === "WHATSAPP") ?? phones[0];

  return (
    <div className="space-y-6">
      <Link href="/contacts" className="text-sm text-muted hover:underline">← Contacts</Link>
      {sp.created && <div className="pop rounded-2xl bg-gradient-to-r from-primary to-accent px-5 py-3 text-white shadow-md"><strong>Contact added!</strong> <span className="text-white/85">+10 XP. It is already visible to your pipeline, leads and reports{leads.length ? ", and an opportunity is open for it" : ""}.</span></div>}
      {sp.saved && <Notice kind="ok">Saved. Linked leads and the client account were updated too.</Notice>}
      {sp.logged && <Notice kind="ok">Logged. It also appears on the linked lead. +5 XP</Notice>}
      {sp.opened && <Notice kind="ok">Opportunity opened. You can move it on the Opportunities board.</Notice>}
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
        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-6">
            <section className="card space-y-4">
              <h2 className="font-semibold">Contact details</h2>
              <dl className="space-y-3 text-sm">
                {phones.length > 0 && <div><dt className="label">Phone</dt>{phones.map((p) => <dd key={p.value} className="flex items-center justify-between py-0.5"><span>{p.value} <span className="text-xs text-muted">{p.type.toLowerCase()}</span></span><a className="text-xs font-medium text-primary" href={`tel:${p.value.replace(/[^\d+]/g, "")}`}>Call</a></dd>)}</div>}
                {emails.length > 0 && <div><dt className="label">Email</dt>{emails.map((e) => <dd key={e.value} className="flex items-center justify-between py-0.5"><span className="truncate">{e.value} <span className="text-xs text-muted">{e.type.toLowerCase()}</span></span><a className="text-xs font-medium text-primary" href={`mailto:${e.value}`}>Write</a></dd>)}</div>}
                {c.website && <div><dt className="label">Website</dt><dd>{/^https?:\/\//.test(c.website) ? <a className="text-primary underline" href={c.website} target="_blank" rel="noopener noreferrer">{c.website}</a> : c.website}</dd></div>}
                {(c.addressLine || c.city || c.country) && <div><dt className="label">Address</dt><dd>{[c.addressLine, c.city, c.state, c.postalCode, c.country].filter(Boolean).join(", ")}</dd></div>}
                {c.industry && <div><dt className="label">Industry</dt><dd>{c.industry}</dd></div>}
                {c.source && <div><dt className="label">Source</dt><dd>{c.source}</dd></div>}
                {c.preferredContact && <div><dt className="label">Prefers</dt><dd>{c.preferredContact.toLowerCase()}{c.timezone && ` · ${c.timezone}`}</dd></div>}
                {c.tags.length > 0 && <div><dt className="label">Tags</dt><dd className="flex flex-wrap gap-1">{c.tags.map((t) => <Link key={t} href={`/contacts?tag=${encodeURIComponent(t)}`}><Badge tone="primary">{t}</Badge></Link>)}</dd></div>}
                {c.followers.length > 0 && <div><dt className="label">Followers</dt><dd>{c.followers.map((f) => name.get(f) ?? "Former staff").join(", ")}</dd></div>}
                {Object.entries(c.customFields as Record<string, string>).map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd>{v}</dd></div>)}
                {c.notes && <div><dt className="label">Notes</dt><dd className="whitespace-pre-line">{c.notes}</dd></div>}
              </dl>
              {phones.length + emails.length === 0 && !c.website && !c.city && <p className="text-sm text-muted">No contact details yet. Use Edit to add phone numbers and emails.</p>}
            </section>
            {meetings.length > 0 && <section className="card space-y-2"><h2 className="font-semibold">Upcoming meetings</h2><ul className="text-sm">{meetings.map((m) => <li key={m.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><Link className="hover:underline" href={`/meetings/${m.id}`}>{m.title}</Link><span className="text-muted">{m.scheduledAt?.toLocaleString() ?? "now"}</span></li>)}</ul></section>}
          </div>
          <Timeline c={c} canEdit={canEdit} activities={activities.slice(0, 12)} names={name} showAll />
        </div>
      )}

      {tab === "activity" && <Timeline c={c} canEdit={canEdit} activities={activities} names={name} />}

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
          <tbody>{people.map((p) => <tr key={p.id} className="border-t border-border"><td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/contacts/${p.id}`}>{p.name}</Link></td><td className="pr-4">{p.jobTitle}</td><td className="pr-4">{p.primaryEmail}</td><td className="pr-4"><Badge tone={TONE[p.category] ?? "neutral"}>{p.category.toLowerCase()}</Badge></td></tr>)}</tbody></table></div>
      ))}

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

      {canEdit && sp.edit && (
        <Drawer title={`Edit ${c.name}`} closeTo={`/contacts/${c.id}`}>
          <ContactForm mode="edit" staff={staff} orgs={orgs.map((o) => o.name)} campaigns={campaigns} stages={stages} me={user.id} canAssign={manager}
            initial={{ id: c.id, kind: c.kind as "PERSON" | "ORGANIZATION", title: c.title, firstName: c.firstName, lastName: c.lastName, name: c.kind === "ORGANIZATION" ? c.name : null, parentName: parent?.name ?? null, category: c.category, industry: c.industry, jobTitle: c.jobTitle,
              ownerId: c.ownerId, followers: c.followers, website: c.website, phones, emails, addressLine: c.addressLine, city: c.city, state: c.state, country: c.country, postalCode: c.postalCode, timezone: c.timezone, preferredContact: c.preferredContact,
              source: c.source, campaignId: c.campaignId, tags: c.tags, notes: c.notes, customFields: c.customFields as Record<string, string> }} />
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
