import { redirect } from "next/navigation";
import { requireVendorUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { VendorError, markDelivered, submitBill } from "@/lib/vendors";
import { formatMoney } from "@/lib/money";
import { notifyPermission } from "@/lib/notifications";
import FilesPanel from "@/components/FilesPanel";

export const dynamic = "force-dynamic";

async function deliver(formData: FormData) {
  "use server";
  const user = await requireVendorUser();
  try {
    await markDelivered(db, { vendorId: user.vendorId, workOrderId: String(formData.get("id")) });
  } catch (e) {
    if (e instanceof VendorError) redirect(`/vendor/work?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/vendor/work");
}

async function bill(formData: FormData) {
  "use server";
  const user = await requireVendorUser();
  try {
    const b = await submitBill(db, {
      organizationId: user.organizationId, vendorId: user.vendorId, workOrderId: String(formData.get("id")),
      amount: String(formData.get("amount") ?? ""), reference: String(formData.get("reference") ?? ""),
    });
    await notifyPermission(db, user.organizationId, "vendors.bills", { kind: "vendor.bill", title: `Vendor bill ${b.number} submitted`, body: `${b.amount.toString()} ${b.currency}`, link: "/procurement", dedupeKey: `vendor-bill:${b.id}` });
  } catch (e) {
    if (e instanceof VendorError) redirect(`/vendor/work?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/vendor/work");
}

export default async function VendorWork({ searchParams }: { searchParams: Promise<{ error?: string; fileError?: string; fileOk?: string }> }) {
  const user = await requireVendorUser();
  const { error, fileError, fileOk } = await searchParams;
  const [orders, bills] = await Promise.all([
    db.workOrder.findMany({ where: { vendorId: user.vendorId }, orderBy: { createdAt: "desc" }, select: { id: true, number: true, title: true, scope: true, amount: true, currency: true, status: true } }),
    db.vendorBill.findMany({ where: { vendorId: user.vendorId }, orderBy: { createdAt: "desc" }, select: { id: true, number: true, workOrderId: true, amount: true, currency: true, status: true, decisionNote: true } }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Work orders and bills</h1>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      {orders.length === 0 && <div className="card text-sm text-muted">No work orders yet.</div>}
      {orders.map((w) => {
        const mine = bills.filter((b) => b.workOrderId === w.id);
        return (
          <article key={w.id} className="card space-y-2">
            <div className="flex justify-between"><h2 className="font-semibold">{w.number} · {w.title}</h2><span className="text-sm">{formatMoney(w.amount, w.currency)} · {w.status.toLowerCase()}</span></div>
            {w.status === "ISSUED" && <form action={deliver}><input type="hidden" name="id" value={w.id} /><button className="btn">Mark as delivered</button></form>}
            {w.status === "DELIVERED" && <p className="text-sm text-muted">Waiting for acceptance.</p>}
            {w.status === "ACCEPTED" && (
              <form action={bill} className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
                <input type="hidden" name="id" value={w.id} />
                <div><label className="label" htmlFor={`a${w.id}`}>Bill amount ({w.currency})</label><input id={`a${w.id}`} name="amount" required inputMode="decimal" className="input !w-36" /></div>
                <div><label className="label" htmlFor={`r${w.id}`}>Your invoice reference</label><input id={`r${w.id}`} name="reference" className="input" /></div>
                <button className="btn">Submit bill</button>
              </form>
            )}
            {mine.length > 0 && (
              <div className="space-y-2 border-t border-border pt-2">
                {mine.map((b) => (
                  <div key={b.id} className="space-y-1">
                    <p className="text-sm">{b.number}: {formatMoney(b.amount, b.currency)} · {b.status.toLowerCase()}{b.decisionNote && ` (${b.decisionNote})`}</p>
                    <FilesPanel user={user} ownerType="VENDOR_BILL" ownerId={b.id} returnTo="/vendor/work" title={`Your invoice for ${b.number}`} flash={{ fileError, fileOk }} />
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
