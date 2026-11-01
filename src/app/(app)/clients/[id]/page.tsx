import Link from "next/link";
import { Avatar, Badge, Chips, Empty, Notice, StatusBadge } from "@/components/ui";
import { projectProgress } from "@/lib/project-rules";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { clientStatement } from "@/lib/accounting";
import EmailDocForm from "@/components/EmailDocForm";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import InviteForm from "./InviteForm";
import RefundForm from "./RefundForm";
import ServicesTab from "./ServicesTab";
import { CLIENT_TYPE_LABEL } from "@/lib/engagements";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; mailOk?: string; mailError?: string; tab?: string; saved?: string }> }) {
  const user = await requirePermission("clients.view");
  const { id } = await params;
  const sp = await searchParams;
  const { error } = sp;
  const client = await db.client.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!client) notFound();
  const canSeeFinance = user.permissions.has("finance.view");
  const banks = user.permissions.has("finance.refund") ? await db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, ledgerAccountId: { not: null } } }) : [];
  const [statement, invoices] = canSeeFinance
    ? await Promise.all([
        clientStatement(db, user.organizationId, client.id),
        db.invoice.findMany({ where: { clientId: client.id, status: { not: "DRAFT" } }, orderBy: { issueDate: "desc" } }),
      ])
    : [null, []];
  const has = (p: string) => user.permissions.has(p as never);
  const TABS: [string, string][] = [["overview", "Overview"], ["services", "Services"], ...(canSeeFinance ? [["billing", "Billing"] as [string, string]] : []), ...(has("projects.view") ? [["projects", "Projects"] as [string, string]] : []), ...(has("campaigns.view") ? [["campaigns", "Campaigns"] as [string, string]] : []), ...(has("clients.edit") ? [["portal", "Portal access"] as [string, string]] : [])];
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const tabHref = (k: string) => (k === "overview" ? `/clients/${client.id}` : `/clients/${client.id}?tab=${k}`);
  const [projects, campaigns, portalUsers, quotes, contracts] = await Promise.all([
    tab === "projects" ? db.project.findMany({ where: { organizationId: user.organizationId, clientId: client.id }, orderBy: { createdAt: "desc" }, include: { tasks: { select: { status: true, dueDate: true, parentId: true } } } }) : [],
    tab === "campaigns" ? db.campaignClient.findMany({ where: { clientId: client.id, campaign: { organizationId: user.organizationId } }, include: { campaign: { select: { id: true, name: true, code: true, status: true, archivedAt: true } } } }) : [],
    tab === "portal" ? db.user.findMany({ where: { clientId: client.id, organizationId: user.organizationId }, select: { id: true, name: true, email: true, active: true, lastLoginAt: true, createdAt: true }, orderBy: { createdAt: "asc" } }) : [],
    tab === "billing" && has("quotes.view") ? db.quote.findMany({ where: { clientId: client.id, organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 8 }) : [],
    tab === "billing" && has("contracts.view") ? db.contract.findMany({ where: { clientId: client.id, organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 8 }) : [],
  ]);
  return (
    <div className="space-y-6">
      <Link href="/clients" className="text-sm text-muted hover:underline">← All clients</Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4"><Avatar name={client.name} size={56} /><div><h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{client.name}<StatusBadge status={client.active ? "ACTIVE" : "ENDED"} /></h1><p className="text-sm text-muted">{client.code} · {CLIENT_TYPE_LABEL[client.clientType]} · bills in {client.currency}, {client.paymentTermsDays}-day terms</p></div></div>
        <div className="flex flex-wrap gap-2">
          {client.email && <Link href={`/mail/compose?client=${client.id}`} className="btn-ghost">Write an email</Link>}
          {client.contactId && user.permissions.has("crm.view") && <Link href={`/contacts/${client.contactId}`} className="btn-ghost">Open contact</Link>}
        </div>
      </header>
      {tab === "overview" && <section className="card text-sm grid grid-cols-3 gap-y-2 max-w-2xl">
        {([["Email", client.email], ["Phone", client.phone], ["Country", client.country], ["Tax ID", client.taxId],
          ["Billing currency", client.currency], ["Payment terms", `${client.paymentTermsDays} days`], ["Address", client.billingAddress]] as [string, string | null][]).map(([k, v]) => (
          <div key={k} className="contents"><span className="text-muted">{k}</span><span className="col-span-2">{v ?? ""}</span></div>
        ))}
      </section>}
      {error && <Notice kind="error">{error}</Notice>}
      {sp.saved && <Notice kind="ok">Saved.</Notice>}
      <Chips current={tab} items={TABS.map(([k, l]) => ({ key: k, label: l, href: tabHref(k) }))} />
      {tab === "services" && <ServicesTab organizationId={user.organizationId} client={client} canEdit={has("clients.edit")} />}
      {tab === "portal" && (
        <>
          <InviteForm clientId={client.id} />
          <section className="card space-y-2"><h2 className="font-semibold">People with portal access ({portalUsers.length})</h2>
            {portalUsers.length === 0 ? <p className="text-sm text-muted">Nobody has accepted an invitation yet. Invite someone above; the link is shown once and valid for a limited time.</p> : (
              <ul className="text-sm">{portalUsers.map((u) => <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-0"><span>{u.name} <span className="text-xs text-muted">{u.email}</span></span><span className="flex items-center gap-2 text-xs text-muted">{u.lastLoginAt ? `last sign-in ${u.lastLoginAt.toLocaleDateString()}` : "never signed in"}{u.active ? <Badge tone="success">active</Badge> : <Badge tone="danger">disabled</Badge>}</span></li>)}</ul>
            )}
            <p className="text-xs text-muted">Portal users see only this client&apos;s issued invoices, statements, quotations, content approvals, meetings and the tasks shared with them.</p>
          </section>
        </>
      )}
      {tab === "projects" && (
        <section className="card !p-0"><h2 className="border-b border-border px-5 py-3 font-semibold">Projects ({projects.length})</h2>
          {projects.length === 0 ? <div className="px-5 py-8"><Empty title="No projects">Projects for this client will appear here.</Empty></div> : (
            <ul className="divide-y divide-border text-sm">{projects.map((p) => { const open = p.tasks.filter((t) => t.status !== "DONE" && !t.parentId).length; return <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name} <span className="text-xs font-normal text-muted">{p.number}</span></Link><span className="flex items-center gap-3 text-xs text-muted">{projectProgress(p.tasks)}% done · {open} open task{open === 1 ? "" : "s"}<StatusBadge status={p.status} /></span></li>; })}</ul>
          )}
        </section>
      )}
      {tab === "campaigns" && (
        <section className="card space-y-2"><h2 className="font-semibold">Campaigns for this client ({campaigns.length})</h2>
          {campaigns.length === 0 ? <p className="text-sm text-muted">Not linked to any campaign. Link clients on a campaign page.</p> : <ul className="text-sm">{campaigns.map((c) => <li key={c.campaignId} className="flex items-center justify-between border-t border-border py-1.5 first:border-0"><Link className="hover:underline" href={`/campaigns/${c.campaignId}`}>{c.campaign.name}</Link><span className="text-xs text-muted">{c.campaign.code} · <StatusBadge status={c.campaign.archivedAt ? "ARCHIVED" : c.campaign.status} /></span></li>)}</ul>}
        </section>
      )}
      {tab === "billing" && (quotes.length > 0 || contracts.length > 0) && (
        <section className="card grid gap-4 text-sm sm:grid-cols-2">
          <div><h2 className="mb-1 font-semibold">Quotations</h2>{quotes.length === 0 ? <p className="text-muted">None</p> : <ul>{quotes.map((q) => <li key={q.id} className="flex items-center justify-between border-t border-border py-1 first:border-0"><Link className="hover:underline" href={`/quotes/${q.id}`}>{q.number}</Link><span className="flex items-center gap-2">{formatMoney(q.total, q.currency)}<StatusBadge status={q.status} /></span></li>)}</ul>}</div>
          <div><h2 className="mb-1 font-semibold">Contracts</h2>{contracts.length === 0 ? <p className="text-muted">None</p> : <ul>{contracts.map((c) => <li key={c.id} className="flex items-center justify-between border-t border-border py-1 first:border-0"><Link className="hover:underline" href={`/contracts/${c.id}`}>{c.title}</Link><StatusBadge status={c.status} /></li>)}</ul>}</div>
        </section>
      )}
      {tab === "billing" && user.permissions.has("finance.refund") && statement?.advances.map((a) => (
        <RefundForm key={a.currency} clientId={client.id} currency={a.currency} held={a.amount.toString()} banks={banks.filter((b) => b.currency === a.currency).map((b) => ({ id: b.id, name: b.internalName }))} />
      ))}
      {tab === "billing" && statement && (
        <section className="card overflow-x-auto space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Account statement</h2><a className="btn-ghost" href={`/clients/${client.id}/statement/pdf`} target="_blank" rel="noopener">Statement PDF</a></div>
          {user.permissions.has("finance.post") && <EmailDocForm kind="STATEMENT" id={client.id} defaultTo={client.email} returnTo={`/clients/${client.id}`} flash={{ mailOk: sp.mailOk, mailError: sp.mailError }} label="Email the statement" />}
          {statement.advances.map((a) => (
            <p key={a.currency} className="text-sm">Advance held on account: <strong>{formatMoney(a.amount, a.currency)}</strong></p>
          ))}
          {statement.rows.length === 0 ? (
            <p className="text-sm text-muted">No transactions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-hover/60 text-left text-xs text-muted">
                <tr><th className="py-2 pr-4">Date</th><th className="pr-4">Document</th><th className="pr-4">Description</th><th className="pr-4 text-right">Debit</th><th className="pr-4 text-right">Credit</th><th className="text-right">Balance</th></tr>
              </thead>
              <tbody>
                {statement.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border transition hover:bg-hover/50">
                    <td className="py-2 pr-4 whitespace-nowrap">{r.date.toLocaleDateString()}</td>
                    <td className="pr-4">{r.number}</td>
                    <td className="pr-4">{r.description}</td>
                    <td className="pr-4 text-right">{r.debit.gt(0) ? formatMoney(r.debit, r.currency) : ""}</td>
                    <td className="pr-4 text-right">{r.credit.gt(0) ? formatMoney(r.credit, r.currency) : ""}</td>
                    <td className="text-right font-medium">{formatMoney(r.balance, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {invoices.length > 0 && (
            <p className="text-sm text-muted">
              Invoices: {invoices.map((i) => (
                <Link key={i.id} href={`/finance/invoices/${i.id}`} className="underline mr-3">{i.number}</Link>
              ))}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
