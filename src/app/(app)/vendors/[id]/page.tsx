import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { vendorLedger } from "@/lib/vendors";
import { changeStatus } from "./actions";
import VendorInviteForm from "./VendorInviteForm";

export const dynamic = "force-dynamic";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("vendors.view");
  const { id } = await params;
  const v = await db.vendor.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!v) notFound();
  const canManage = user.permissions.has("vendors.manage");
  const [ledger, workOrders, portalUsers] = await Promise.all([
    vendorLedger(db, user.organizationId, v.id),
    db.workOrder.findMany({ where: { vendorId: v.id }, orderBy: { createdAt: "desc" } }),
    db.user.count({ where: { vendorId: v.id } }),
  ]);
  return (
    <div className="space-y-6">
      <Link href="/vendors" className="text-sm text-muted hover:underline">← All vendors</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{v.name} <span className="text-base font-normal text-muted">{v.code} · {v.status.toLowerCase()}</span></h1>
      <section className="card text-sm grid grid-cols-3 gap-y-1 max-w-2xl">
        {([["Email", v.email], ["Phone", v.phone], ["Country", v.country], ["Categories", v.categories], ["Currency", v.currency], ["Payment terms", `${v.paymentTermsDays} days`], ["Portal users", String(portalUsers)]] as [string, string | null][]).map(([k, x]) => (
          <div key={k} className="contents"><span className="text-muted">{k}</span><span className="col-span-2">{x ?? ""}</span></div>
        ))}
      </section>
      {canManage && (
        <div className="flex gap-2">
          {v.status !== "APPROVED" && <form action={changeStatus}><input type="hidden" name="vendorId" value={v.id} /><input type="hidden" name="status" value="APPROVED" /><button className="btn">Approve vendor</button></form>}
          {v.status !== "SUSPENDED" && <form action={changeStatus}><input type="hidden" name="vendorId" value={v.id} /><input type="hidden" name="status" value="SUSPENDED" /><button className="btn-ghost">Suspend vendor</button></form>}
        </div>
      )}
      {canManage && <VendorInviteForm vendorId={v.id} defaultEmail={v.email ?? ""} />}
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Vendor ledger (amounts we owe)</h2>
        {ledger.length === 0 ? <p className="text-sm text-muted">No posted bills or payments yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Date</th><th className="pr-4">Entry</th><th className="pr-4">Description</th><th className="pr-4 text-right">Billed</th><th className="pr-4 text-right">Paid</th><th className="text-right">Balance owed</th></tr></thead>
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
      <section className="card">
        <h2 className="font-semibold mb-2">Work orders</h2>
        {workOrders.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="text-sm">{workOrders.map((w) => <li key={w.id} className="border-t border-border py-1.5 first:border-0">{w.number} · {w.title} · {formatMoney(w.amount, w.currency)} · {w.status.toLowerCase()}</li>)}</ul>
        )}
      </section>
    </div>
  );
}
