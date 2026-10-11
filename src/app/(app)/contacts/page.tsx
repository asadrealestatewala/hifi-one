import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { Empty, Notice } from "@/components/ui";
import Icon from "@/components/shell/Icon";
import { backfillContacts, listContacts, questFor, type ListQuery } from "@/lib/crm-contacts";
import { db } from "@/lib/db";
import ContactForm from "./ContactForm";
import ContactsTable from "./ContactsTable";
import Drawer from "@/components/ui/Drawer";
import QuestCard from "./QuestCard";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

const CATS = ["LEAD", "CUSTOMER", "PARTNER", "VENDOR", "INVESTOR", "OTHER"];

export default async function Contacts({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const who = { id: user.id, organizationId: org, permissions: user.permissions };
  const canEdit = user.permissions.has("crm.edit"), manager = user.permissions.has("crm.view_all");
  const tab = sp.tab === "organizations" || sp.tab === "contacts" ? sp.tab : "all";
  const sort = ["name", "owner", "activity", "created", "category"].includes(sp.sort ?? "") ? sp.sort! : "activity";
  const dir = sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : sort === "name" ? "asc" : "desc";
  const query: ListQuery = { tab, q: sp.q, category: sp.category, ownerId: sp.owner, tag: sp.tag, source: sp.source, archived: sp.archived === "1", sort, dir, page: Number(sp.page) || 1, pageSize: 25 };
  // First visit after an upgrade: give every existing lead and client its contact record
  if ((await db.contact.count({ where: { organizationId: org } })) === 0) await backfillContacts(db, org);
  const [list, quest, staff, orgsAll, campaigns, stages] = await Promise.all([
    listContacts(db, who, query),
    questFor(db, { organizationId: org, userId: user.id }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    canEdit && sp.new ? db.contact.findMany({ where: { organizationId: org, kind: "ORGANIZATION", archived: false }, orderBy: { name: "asc" }, select: { name: true }, take: 500 }) : Promise.resolve([]),
    canEdit && sp.new ? db.campaign.findMany({ where: { organizationId: org, status: { in: ["ACTIVE", "PLANNED"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    canEdit && sp.new ? db.pipelineStage.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const owner = new Map(staff.map((s) => [s.id, s.name]));
  const qs = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); const all = { tab: tab === "all" ? undefined : tab, q: sp.q, category: sp.category, owner: sp.owner, tag: sp.tag, source: sp.source, archived: sp.archived, sort: sp.sort, dir: sp.dir, ...over }; for (const [k, v] of Object.entries(all)) if (v) p.set(k, v); const s = p.toString(); return `/contacts${s ? `?${s}` : ""}`; };
  const sortLink = (key: string) => ({ href: qs({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc", page: undefined }), dir: sort === key ? (dir as "asc" | "desc") : null });
  const filtersOn = [sp.category, sp.owner, sp.tag, sp.source].filter(Boolean).length;
  const tabs: [string, string, number | null][] = [["all", "All", list.tabCounts.organizations + list.tabCounts.contacts], ["organizations", "Organizations", list.tabCounts.organizations], ["contacts", "Contacts", list.tabCounts.contacts]];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Contacts</h1><p className="mt-1 text-sm text-muted">Every person and company you work with, synced with leads, opportunities, clients and meetings.</p></div>
        {canEdit && <Link href={qs({ new: "1" })} className="btn"><Icon name="plus" className="h-4 w-4" />New contact</Link>}
      </div>

      <QuestCard name={user.name} {...quest} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.added && <Notice kind="ok">Saved. Add the next one below. +10 XP</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Account type" className="flex gap-1 rounded-xl bg-hover p-1 text-sm">
          {tabs.map(([k, label, n]) => <Link key={k} href={qs({ tab: k === "all" ? undefined : k, page: undefined })} aria-current={tab === k ? "page" : undefined} className={`rounded-lg px-3 py-1.5 font-medium transition ${tab === k ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}>{label}<span className="ml-1.5 text-xs text-muted">{n}</span></Link>)}
        </nav>
        <form action="/contacts" role="search" className="relative min-w-60 flex-1 sm:max-w-sm">
          {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={sp.q} placeholder="Search name, email, phone, tag…" aria-label="Search contacts" className="input !pl-9" />
        </form>
        <details className="relative">
          <summary className={`btn-ghost cursor-pointer list-none ${filtersOn ? "!border-primary !text-primary" : ""}`}><Icon name="chart" className="h-4 w-4" />Filters{filtersOn > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-white">{filtersOn}</span>}</summary>
          <form action="/contacts" className="absolute left-0 z-20 mt-2 grid w-80 gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xl">
            {tab !== "all" && <input type="hidden" name="tab" value={tab} />}{sp.q && <input type="hidden" name="q" value={sp.q} />}
            <div><label className="label" htmlFor="fc">Category</label><select id="fc" name="category" defaultValue={sp.category ?? ""} className="input"><option value="">Any</option>{CATS.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}</select></div>
            <div><label className="label" htmlFor="fo">Owner</label><select id="fo" name="owner" defaultValue={sp.owner ?? ""} className="input"><option value="">Anyone</option><option value="none">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="label" htmlFor="ft">Tag</label><input id="ft" name="tag" defaultValue={sp.tag ?? ""} className="input" /></div>
            <div><label className="label" htmlFor="fs">Source</label><input id="fs" name="source" defaultValue={sp.source ?? ""} className="input" placeholder="e.g. LinkedIn" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} /> Show archived</label>
            <div className="flex gap-2"><button className="btn flex-1">Apply</button><Link href={qs({ category: undefined, owner: undefined, tag: undefined, source: undefined, archived: undefined })} className="btn-ghost">Reset</Link></div>
          </form>
        </details>
        <Link href={`/contacts/export?${new URLSearchParams(Object.entries({ tab: tab === "all" ? "" : tab, q: sp.q ?? "", category: sp.category ?? "", owner: sp.owner ?? "", tag: sp.tag ?? "", source: sp.source ?? "", archived: sp.archived ?? "" }).filter(([, v]) => v)).toString()}`} className="btn-ghost" prefetch={false}>Export CSV</Link>
      </div>

      {list.rows.length === 0 ? (
        <Empty title={sp.q || filtersOn ? "No contacts match" : "No contacts yet"}>{sp.q || filtersOn ? "Try a different search or clear the filters." : canEdit ? "Add your first contact with the New contact button. Leads you create also appear here automatically." : "Contacts you own will appear here."}</Empty>
      ) : (
        <ContactsTable
          key={list.rows.map((r) => r.id).join(",") + list.rows.map((r) => `${r.primaryEmail}${r.primaryPhone}`).join("")}
          rows={list.rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, category: r.category, parentName: r.parentName, email: r.primaryEmail, phone: (r.phones as { value: string }[])[0]?.value ?? r.primaryPhone, ownerId: r.ownerId, ownerName: r.ownerId ? owner.get(r.ownerId) ?? null : null, tags: r.tags, lastActivity: r.lastActivityAt?.toISOString() ?? null }))}
          staff={staff} canEdit={canEdit} canAssign={manager} returnTo={qs({})}
          sortLinks={{ name: sortLink("name"), owner: sortLink("owner"), activity: sortLink("activity") }}
        />
      )}
      {list.pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pages">
          <span className="text-muted">Page {list.page} of {list.pages} · {list.total} contacts</span>
          <span className="flex gap-2">{list.page > 1 && <Link className="btn-ghost" href={qs({ page: String(list.page - 1) })}>Previous</Link>}{list.page < list.pages && <Link className="btn-ghost" href={qs({ page: String(list.page + 1) })}>Next</Link>}</span>
        </nav>
      )}

      {canEdit && sp.new && (
        <Drawer title="New contact" closeTo={qs({ new: undefined })}>
          <ContactForm mode="create" initial={{ kind: "PERSON" }} staff={staff} orgs={orgsAll.map((o) => o.name)} campaigns={campaigns} stages={stages} me={user.id} canAssign={manager} />
        </Drawer>
      )}
    </div>
  );
}
