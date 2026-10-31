import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { vendorLedger } from "@/lib/vendors";
import { Badge, Chips, Empty, StatusBadge } from "@/components/ui";
import FilesPanel from "@/components/FilesPanel";
import { changeStatus } from "./actions";
import VendorInviteForm from "./VendorInviteForm";

export const dynamic = "force-dynamic";

export default async function VendorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; fileError?: string; fileOk?: string }> }) {
  const user = await requirePermission("vendors.view");
  const { id } = await params;
  const sp = await searchParams;
  const v = await db.vendor.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!v) notFound();
  const canManage = user.permissions.has("vendors.manage");
  const TABS: [string, string][] = [["overview", "Overview"], ["work", "Work"], ["billing", "Bills and ledger"], ["documents", "Documents"], ...(canManage ? [["portal", "Portal access"] as [string, string]] : [])];
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const tabHref = (k: string) => (k === "overview" ? `/vendors/${v.id}` : `/vendors/${v.id}?tab=${k}`);
  const [ledger, workOrders, portalUsers, applications, bills] = await Promise.all([
    tab === "billing" ? vendorLedger(db, user.organizationId, v.id) : [],
    tab === "work" || tab === "overview" ? db.workOrder.findMany({ where: { vendorId: v.id }, orderBy: { createdAt: "desc" } }) : [],
    db.user.findMany({ where: { vendorId: v.id }, select: { id: true, name: true, email: true, active: true, lastLoginAt: true }, orderBy: { createdAt: "asc" } }),
    tab === "work" ? db.vendorApplication.findMany({ where: { vendorId: v.id }, orderBy: { createdAt: "desc" }, take: 10, include: { opportunity: { select: { title: true } } } }) : [],
    tab === "billing" ? db.vendorBill.findMany({ where: { vendorId: v.id }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
  ]);
  const open = workOrders.filter((w) => !["PAID", "CANCELLED", "REJECTED"].includes(w.status)).length;
  return (
    <div className="space-y-6">
      <Link href="/vendors" className="text-sm text-muted hover:underline">← All vendors</Link>
      <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{v.name} <span className="text-base font-normal text-muted">{v.code}</span><StatusBadge status={v.status} /></h1>
      <Chips current={tab} items={TABS.map(([k, l]) => ({ key: k, label: l, href: tabHref(k) }))} />

      {tab === "overview" && (
        <>
          <section className="card text-sm grid grid-cols-3 gap-y-1 max-w-2xl">
            {([["Email", v.email], ["Phone", v.phone], ["Country", v.country], ["Categories", v.categories], ["Currency", v.currency], ["Payment terms", `${v.paymentTermsDays} days`], ["Portal users", String(portalUsers.length)], ["Open work orders", String(open)]] as [string, string | null][]).map(([k, x]) => (
              <div key={k} className="contents"><span className="text-muted">{k}</span><span className="col-span-2">{x ?? ""}</span></div>
            ))}
          </section>
          {canManage && (
            <div className="flex gap-2">
              {v.status !== "APPROVED" && <form action={changeStatus}><input type="hidden" name="vendorId" value={v.id} /><input type="hidden" name="status" value="APPROVED" /><button className="btn">Approve vendor</button></form>}
              {v.status !== "SUSPENDED" && <form action={changeStatus}><input type="hidden" name="vendorId" value={v.id} /><input type="hidden" name="status" value="SUSPENDED" /><button className="btn-ghost">Suspend vendor</button></form>}
            </div>
          )}
        </>
      )}

      {tab === "work" && (
        <>
          <section className="card space-y-2"><h2 className="font-semibold">Work orders ({workOrders.length})</h2>
            {workOrders.length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="text-sm">{workOrders.map((w) => <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-1.5 first:border-0"><span>{w.number} · {w.title}</span><span className="flex items-center gap-2">{formatMoney(w.amount, w.currency)}<StatusBadge status={w.status} /></span></li>)}</ul>}
          </section>
          <section className="card space-y-2"><h2 className="font-semibold">Applications to opportunities</h2>
            {applications.length === 0 ? <p className="text-sm text-muted">This vendor has not applied to any opportunity.</p> : <ul className="text-sm">{applications.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-1.5 first:border-0"><span>{a.opportunity.title}</span><span className="flex items-center gap-2">{formatMoney(a.quoteAmount, v.currency)}<StatusBadge status={a.status} /></span></li>)}</ul>}
            <Link href="/procurement" className="text-sm text-primary hover:underline">Open procurement</Link>
          </section>
        </>
      )}

      {tab === "billing" && (
        <>
          <section className="card space-y-2"><h2 className="font-semibold">Bills</h2>
            {bills.length === 0 ? <p className="text-sm text-muted">No bills yet.</p> : <ul className="text-sm">{bills.map((b) => <li key={b.id} className="flex items-center justify-between border-t border-border py-1.5 first:border-0"><span>{b.number}</span><span className="flex items-center gap-2">{formatMoney(b.amount, b.currency)}<StatusBadge status={b.status} /></span></li>)}</ul>}
          </section>
          <section className="card overflow-x-auto">
            <h2 className="font-semibold mb-2">Vendor ledger (amounts we owe)</h2>
            {ledger.length === 0 ? <p className="text-sm text-muted">No posted bills or payments yet.</p> : (
              <table className="w-full text-sm">
                <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Date</th><th className="pr-4">Entry</th><th className="pr-4">Description</th><th className="pr-4 text-right">Billed</th><th className="pr-4 text-right">Paid</th><th className="text-right">Balance</th></tr></thead>
                <tbody>
                  {ledger.map((l, i) => (
                    <tr key={i} className="border-t border-border transition hover:bg-hover/50">
                      <td className="py-2 pr-4">{l.date.toLocaleDateString()}</td><td className="pr-4">{l.number}</td><td className="pr-4">{l.description}</td>
                      <td className="pr-4 text-right">{l.billed.gt(0) ? formatMoney(l.billed, l.currency) : ""}</td><td className="pr-4 text-right">{l.paid.gt(0) ? formatMoney(l.paid, l.currency) : ""}</td>
                      <td className="text-right font-medium">{formatMoney(l.balance, l.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {tab === "documents" && <FilesPanel user={user} ownerType="VENDOR_DOC" ownerId={v.id} returnTo={`/vendors/${v.id}?tab=documents`} title="Compliance documents" withCategory withExpiry flash={{ fileError: sp.fileError, fileOk: sp.fileOk }} />}

      {tab === "portal" && canManage && (
        <>
          <VendorInviteForm vendorId={v.id} defaultEmail={v.email ?? ""} />
          <section className="card space-y-2"><h2 className="font-semibold">People with portal access ({portalUsers.length})</h2>
            {portalUsers.length === 0 ? <Empty title="Nobody yet">Invite someone above. They see only this vendor&apos;s opportunities, work orders, bills and statement.</Empty> : (
              <ul className="text-sm">{portalUsers.map((u) => <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-0"><span>{u.name} <span className="text-xs text-muted">{u.email}</span></span><span className="flex items-center gap-2 text-xs text-muted">{u.lastLoginAt ? `last sign-in ${u.lastLoginAt.toLocaleDateString()}` : "never signed in"}{u.active ? <Badge tone="success">active</Badge> : <Badge tone="danger">disabled</Badge>}</span></li>)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
