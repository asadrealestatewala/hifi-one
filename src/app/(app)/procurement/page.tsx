import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import {
  VendorError, acceptDelivery, approveBill, createOpportunity, decideApplication, issueWorkOrder, payBill, postBill, rejectBill,
} from "@/lib/vendors";
import { formatMoney } from "@/lib/money";
import FilesPanel from "@/components/FilesPanel";
import { vendorBillChanged } from "@/lib/events";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// One server action for the whole workflow. Each form carries its own hidden "op" field and the matching permission is checked here.
const PERM: Record<string, Parameters<typeof requirePermission>[0]> = {
  create_opportunity: "vendors.manage", decide_application: "vendors.manage", issue_work_order: "vendors.manage", direct_work_order: "vendors.manage",
  accept: "vendors.manage", return: "vendors.manage", approve_bill: "vendors.bills", reject_bill: "vendors.bills", post_bill: "vendors.post", pay_bill: "vendors.post",
};

async function act(formData: FormData) {
  "use server";
  const op = String(formData.get("op"));
  if (!(op in PERM)) redirect("/procurement");
  const user = await requirePermission(PERM[op]);
  const o = user.organizationId;
  const id = String(formData.get("id") ?? "");
  try {
    if (op === "create_opportunity") {
      const r = await createOpportunity(db, {
        organizationId: o, title: String(formData.get("title") ?? ""), scope: String(formData.get("scope") ?? ""), skills: String(formData.get("skills") ?? ""),
        budgetMin: String(formData.get("budgetMin") ?? ""), budgetMax: String(formData.get("budgetMax") ?? ""), currency: String(formData.get("currency")),
        deadline: String(formData.get("deadline") ?? ""), createdById: user.id,
      });
      await audit(user, { action: "opportunity.create", entity: "VendorOpportunity", entityId: r.id });
    } else if (op === "decide_application") {
      const status = String(formData.get("status"));
      if (!["SHORTLISTED", "APPROVED", "REJECTED"].includes(status)) redirect("/procurement");
      await decideApplication(db, { organizationId: o, id, deciderId: user.id, status: status as "APPROVED" });
      await audit(user, { action: `application.${status.toLowerCase()}`, entity: "VendorApplication", entityId: id });
    } else if (op === "issue_work_order") {
      const w = await issueWorkOrder(db, { organizationId: o, issuedById: user.id, applicationId: id });
      await audit(user, { action: "work_order.issue", entity: "WorkOrder", entityId: w.id, after: { number: w.number } });
    } else if (op === "direct_work_order") {
      const w = await issueWorkOrder(db, {
        organizationId: o, issuedById: user.id, vendorId: String(formData.get("vendorId")), title: String(formData.get("title") ?? ""), amount: String(formData.get("amount") ?? ""),
        projectId: String(formData.get("projectId") ?? "") || undefined,
      });
      await audit(user, { action: "work_order.issue", entity: "WorkOrder", entityId: w.id, after: { number: w.number } });
    } else if (op === "accept" || op === "return") {
      await acceptDelivery(db, { organizationId: o, workOrderId: id, accepterId: user.id, accept: op === "accept" });
      await audit(user, { action: `work_order.${op}`, entity: "WorkOrder", entityId: id });
    } else if (op === "approve_bill") {
      await approveBill(db, { organizationId: o, id, approverId: user.id, expenseAccountId: String(formData.get("expenseAccountId")) });
      await audit(user, { action: "vendor_bill.approve", entity: "VendorBill", entityId: id });
      await vendorBillChanged(db, { organizationId: o, billId: id });
    } else if (op === "reject_bill") {
      await rejectBill(db, { organizationId: o, id, note: String(formData.get("note") ?? "") });
      await audit(user, { action: "vendor_bill.reject", entity: "VendorBill", entityId: id });
      await vendorBillChanged(db, { organizationId: o, billId: id });
    } else if (op === "post_bill") {
      await postBill(db, { organizationId: o, id, actorId: user.id });
      await audit(user, { action: "vendor_bill.post", entity: "VendorBill", entityId: id });
    } else if (op === "pay_bill") {
      await payBill(db, { organizationId: o, id, bankAccountId: String(formData.get("bankAccountId")), actorId: user.id });
      await audit(user, { action: "vendor_bill.pay", entity: "VendorBill", entityId: id });
      await vendorBillChanged(db, { organizationId: o, billId: id });
    }
  } catch (e) {
    if (e instanceof VendorError || e instanceof LedgerError) redirect(`/procurement?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/procurement");
}

const Op = ({ op, id }: { op: string; id?: string }) => (
  <>
    <input type="hidden" name="op" value={op} />
    {id && <input type="hidden" name="id" value={id} />}
  </>
);

export default async function Procurement({ searchParams }: { searchParams: Promise<{ error?: string; fileError?: string; fileOk?: string }> }) {
  const user = await requirePermission("vendors.view");
  const { error, fileError, fileOk } = await searchParams;
  const can = (p: Parameters<typeof user.permissions.has>[0]) => user.permissions.has(p);
  const org = user.organizationId;
  const [opps, orders, bills, vendors, expenseAccounts, banks, projects] = await Promise.all([
    db.vendorOpportunity.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, include: { applications: { include: { vendor: true } } } }),
    db.workOrder.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, include: { vendor: true } }),
    db.vendorBill.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, include: { vendor: true } }),
    db.vendor.findMany({ where: { organizationId: org, status: "APPROVED" }, orderBy: { name: "asc" } }),
    db.account.findMany({ where: { organizationId: org, active: true, type: { in: ["OPEX", "DIRECT_COST", "OTHER_EXPENSE"] } }, orderBy: { code: "asc" } }),
    db.bankAccount.findMany({ where: { organizationId: org, active: true, ledgerAccountId: { not: null } } }),
    can("projects.view") ? db.project.findMany({ where: { organizationId: org }, orderBy: { number: "asc" } }) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader title="Procurement" subtitle="Applying never awards work. Each step needs a person: approve the application, issue the work order, accept the delivery, approve the bill, post it, then pay." />
      {error && <Notice kind="error">{error}</Notice>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Outsourcing opportunities</h2>
        {opps.length === 0 && <div className="card text-sm text-muted">No opportunities yet.</div>}
        {opps.map((p) => (
          <article key={p.id} className="card space-y-2">
            <div className="flex justify-between gap-2"><h3 className="font-semibold">{p.title}</h3><span className="text-xs text-muted">{p.status.toLowerCase()}{p.deadline && ` · apply by ${p.deadline}`}</span></div>
            <p className="text-sm text-muted">{p.scope}{p.budgetMax && ` · Budget ${p.budgetMin ? formatMoney(p.budgetMin, p.currency) + " to " : "up to "}${formatMoney(p.budgetMax, p.currency)}`}</p>
            {p.applications.length === 0 ? <p className="text-xs text-muted">No applications yet.</p> : p.applications.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
                <span className="font-medium">{a.vendor.name}</span><span>quote {formatMoney(a.quoteAmount, p.currency)}</span><span className="text-muted">{a.status.toLowerCase()}</span>
                {a.proposal && <span className="text-xs text-muted w-full">{a.proposal}</span>}
                {can("vendors.manage") && a.status !== "REJECTED" && (
                  <>
                    {a.status !== "APPROVED" && (<>
                      <form action={act}><Op op="decide_application" id={a.id} /><input type="hidden" name="status" value="SHORTLISTED" /><button className="btn-ghost">Shortlist</button></form>
                      <form action={act}><Op op="decide_application" id={a.id} /><input type="hidden" name="status" value="APPROVED" /><button className="btn-ghost">Approve</button></form>
                      <form action={act}><Op op="decide_application" id={a.id} /><input type="hidden" name="status" value="REJECTED" /><button className="btn-ghost">Reject</button></form>
                    </>)}
                    {a.status === "APPROVED" && <form action={act}><Op op="issue_work_order" id={a.id} /><button className="btn">Issue work order</button></form>}
                  </>
                )}
              </div>
            ))}
          </article>
        ))}
        {can("vendors.manage") && (
          <form action={act} className="card grid gap-3 sm:grid-cols-3">
            <Op op="create_opportunity" />
            <h3 className="font-semibold sm:col-span-3">Publish an opportunity</h3>
            <div className="sm:col-span-2"><label className="label" htmlFor="title">Title</label><input id="title" name="title" required className="input" /></div>
            <div><label className="label" htmlFor="deadline">Apply by</label><input id="deadline" name="deadline" type="date" className="input" /></div>
            <div className="sm:col-span-3"><label className="label" htmlFor="scope">Scope and delivery terms</label><textarea id="scope" name="scope" required rows={2} className="input" /></div>
            <div><label className="label" htmlFor="skills">Required skills</label><input id="skills" name="skills" className="input" /></div>
            <div className="grid grid-cols-2 gap-2"><div><label className="label" htmlFor="budgetMin">Budget from</label><input id="budgetMin" name="budgetMin" inputMode="decimal" className="input" /></div>
              <div><label className="label" htmlFor="budgetMax">to</label><input id="budgetMax" name="budgetMax" inputMode="decimal" className="input" /></div></div>
            <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["USD", "PKR", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="sm:col-span-3"><button className="btn">Publish</button></div>
          </form>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Work orders</h2>
        <div className="card overflow-x-auto">
          {orders.length === 0 ? <p className="text-sm text-muted">No work orders yet.</p> : (
            <table className="w-full text-sm">
              <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Number</th><th className="pr-4">Vendor</th><th className="pr-4">Title</th><th className="pr-4 text-right">Amount</th><th className="pr-4">Status</th><th></th></tr></thead>
              <tbody>
                {orders.map((w) => (
                  <tr key={w.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="py-2 pr-4 font-medium">{w.number}</td><td className="pr-4">{w.vendor.name}</td><td className="pr-4">{w.title}</td>
                    <td className="pr-4 text-right">{formatMoney(w.amount, w.currency)}</td><td className="pr-4">{w.status.toLowerCase()}</td>
                    <td className="flex gap-1 py-1">
                      {w.status === "DELIVERED" && can("vendors.manage") && (<>
                        <form action={act}><Op op="accept" id={w.id} /><button className="btn">Accept delivery</button></form>
                        <form action={act}><Op op="return" id={w.id} /><button className="btn-ghost">Send back</button></form>
                      </>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {can("vendors.manage") && (
          <form action={act} className="card grid gap-3 sm:grid-cols-4">
            <Op op="direct_work_order" />
            <h3 className="font-semibold sm:col-span-4">Issue a work order directly (without an opportunity)</h3>
            <div><label className="label" htmlFor="vendorId">Vendor (approved)</label><select id="vendorId" name="vendorId" required className="input"><option value="">Choose…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.currency})</option>)}</select></div>
            <div><label className="label" htmlFor="wtitle">Title</label><input id="wtitle" name="title" required className="input" /></div>
            <div><label className="label" htmlFor="wamount">Amount (vendor currency)</label><input id="wamount" name="amount" required inputMode="decimal" className="input" /></div>
            <div><label className="label" htmlFor="wproject">Project</label><select id="wproject" name="projectId" className="input"><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></div>
            <div className="sm:col-span-4"><button className="btn">Issue work order</button></div>
          </form>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Vendor bills</h2>
        <div className="card space-y-1">
          {bills.length === 0 && <p className="text-sm text-muted">No bills yet.</p>}
          {bills.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm first:border-0">
              <span className="font-medium w-24">{b.number}</span><span className="w-40">{b.vendor.name}</span><span className="w-32">{formatMoney(b.amount, b.currency)}</span>
              <span className="text-muted w-24">{b.status.toLowerCase()}</span>
              <details className="w-full"><summary className="cursor-pointer text-xs text-muted">Documents</summary><div className="mt-1"><FilesPanel user={user} ownerType="VENDOR_BILL" ownerId={b.id} returnTo="/procurement" title="Bill documents" flash={{ fileError, fileOk }} /></div></details>
              {b.status === "SUBMITTED" && can("vendors.bills") && (<>
                <form action={act} className="flex gap-1"><Op op="approve_bill" id={b.id} />
                  <select name="expenseAccountId" required aria-label="Expense account" className="input !w-48"><option value="">Expense account…</option>{expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
                  <button className="btn">Approve</button></form>
                <form action={act} className="flex gap-1"><Op op="reject_bill" id={b.id} /><input name="note" required placeholder="Reason" aria-label="Reason" className="input !w-40" /><button className="btn-ghost">Reject</button></form>
              </>)}
              {b.status === "APPROVED" && can("vendors.post") && <form action={act}><Op op="post_bill" id={b.id} /><button className="btn">Post to ledger</button></form>}
              {b.status === "POSTED" && can("vendors.post") && (
                <form action={act} className="flex gap-1"><Op op="pay_bill" id={b.id} />
                  <select name="bankAccountId" required aria-label="Paid from" className="input !w-44"><option value="">Paid from…</option>{banks.filter((k) => k.currency === b.currency).map((k) => <option key={k.id} value={k.id}>{k.internalName}</option>)}</select>
                  <button className="btn">Record payment</button></form>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
