import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { SalesError, createSubscription, generateDueInvoices, setSubscriptionStatus } from "@/lib/sales";

export const dynamic = "force-dynamic";
const today = () => new Date().toISOString().slice(0, 10);
const bounce = (kind: "error" | "msg", m: string) => redirect(`/finance/subscriptions?${kind}=${encodeURIComponent(m)}`);

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("subscriptions.manage");
  try {
    const s = await createSubscription(db, {
      organizationId: user.organizationId, clientId: String(formData.get("clientId") ?? ""), name: String(formData.get("name") ?? ""), currency: String(formData.get("currency") ?? ""),
      amount: String(formData.get("amount") ?? "").trim(), taxRate: String(formData.get("taxRate") || "0"), interval: String(formData.get("interval") ?? ""),
      startDate: String(formData.get("startDate") ?? ""), endDate: String(formData.get("endDate") ?? "") || null, createdById: user.id,
    });
    await audit(user, { action: "subscription.create", entity: "Subscription", entityId: s.id, after: { name: s.name, amount: s.amount.toString(), interval: s.interval } });
  } catch (e) {
    if (e instanceof SalesError) return bounce("error", e.message);
    throw e;
  }
  bounce("msg", "Subscription created.");
}

async function change(formData: FormData) {
  "use server";
  const user = await requirePermission("subscriptions.manage");
  const op = String(formData.get("op") ?? "").toUpperCase();
  if (!["PAUSE", "RESUME", "CANCEL"].includes(op)) return bounce("error", "Unknown action.");
  const id = String(formData.get("id") ?? "");
  try {
    await setSubscriptionStatus(db, { organizationId: user.organizationId, subscriptionId: id, action: op as "PAUSE" | "RESUME" | "CANCEL", today: today() });
    await audit(user, { action: `subscription.${op.toLowerCase()}`, entity: "Subscription", entityId: id });
  } catch (e) {
    if (e instanceof SalesError) return bounce("error", e.message);
    throw e;
  }
  bounce("msg", "Updated.");
}

async function generate() {
  "use server";
  const user = await requirePermission("subscriptions.manage");
  const created = await generateDueInvoices(db, { organizationId: user.organizationId, today: today(), actorId: user.id });
  await audit(user, { action: "subscription.generate", entity: "Subscription", after: { invoices: created.length } });
  bounce("msg", created.length === 0 ? "Nothing is due." : `${created.length} draft invoice${created.length === 1 ? "" : "s"} created. Review and issue them under Invoices.`);
}

export default async function Subscriptions({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("finance.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("subscriptions.manage");
  const [subs, clients, dueCount, rates] = await Promise.all([
    db.subscription.findMany({ where: { organizationId: org }, orderBy: [{ status: "asc" }, { nextBillingDate: "asc" }], include: { client: true, _count: { select: { invoices: true } } } }),
    db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }),
    db.subscription.count({ where: { organizationId: org, status: "ACTIVE", nextBillingDate: { lte: today() } } }),
    db.taxRate.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }),
  ]);
  const btn = (id: string, op: string, label: string) => (
    <form action={change} className="inline"><input type="hidden" name="id" value={id} /><input type="hidden" name="op" value={op} /><button className="underline text-sm">{label}</button></form>
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        {canManage && (
          <form action={generate} className="flex items-center gap-3">
            <span className="text-sm text-muted">{dueCount} due now</span>
            <button className="btn">Create due invoices</button>
          </form>
        )}
      </div>
      <p className="text-sm text-muted">Each due period creates one <strong>draft</strong> invoice for review. Nothing is issued or posted to the ledger automatically, and running it again never bills the same period twice.</p>
      {sp.msg && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">{sp.msg}</p>}
      {sp.error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{sp.error}</p>}
      <div className="card overflow-x-auto">
        {subs.length === 0 ? <p className="text-sm text-muted">No subscriptions yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Subscription</th><th className="pr-4">Client</th><th className="pr-4 text-right">Amount</th><th className="pr-4">Status</th><th className="pr-4">Next billing</th><th className="pr-4">Invoices</th><th></th></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="py-2 pr-4">{s.name}<span className="block text-xs text-muted">{s.interval.toLowerCase()}, from {s.startDate}{s.endDate ? ` to ${s.endDate}` : ""}</span></td>
                  <td className="pr-4"><Link className="hover:underline" href={`/clients/${s.clientId}`}>{s.client.name}</Link></td>
                  <td className="pr-4 text-right">{formatMoney(s.amount, s.currency)}{Number(s.taxRate) > 0 && <span className="block text-xs text-muted">+ {s.taxRate.toString()}% tax</span>}</td>
                  <td className="pr-4">{s.status.toLowerCase()}</td><td className="pr-4">{s.nextBillingDate ?? ""}</td><td className="pr-4">{s._count.invoices}</td>
                  <td className="space-x-3 whitespace-nowrap">
                    {canManage && s.status === "ACTIVE" && btn(s.id, "PAUSE", "Pause")}
                    {canManage && s.status === "PAUSED" && btn(s.id, "RESUME", "Resume")}
                    {canManage && (s.status === "ACTIVE" || s.status === "PAUSED") && btn(s.id, "CANCEL", "Cancel")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canManage && (
        <form action={create} className="card grid gap-4 sm:grid-cols-4">
          <h2 className="font-semibold sm:col-span-4">New subscription</h2>
          <div className="sm:col-span-2"><label className="label" htmlFor="name">Name</label><input id="name" name="name" required maxLength={120} className="input" placeholder="e.g. Monthly social media management" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" required className="input"><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label" htmlFor="amount">Amount each period</label><input id="amount" name="amount" required inputMode="decimal" className="input" /></div>
          <div><label className="label" htmlFor="taxRate">Tax rate (%)</label><input id="taxRate" name="taxRate" defaultValue="0" list="taxrates" className="input" /><datalist id="taxrates">{rates.map((r) => <option key={r.id} value={r.ratePercent.toString()}>{r.name}</option>)}</datalist></div>
          <div><label className="label" htmlFor="interval">Billed</label><select id="interval" name="interval" className="input"><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annually</option></select></div>
          <div><label className="label" htmlFor="startDate">First billing date</label><input id="startDate" name="startDate" type="date" required defaultValue={today()} className="input" /></div>
          <div><label className="label" htmlFor="endDate">Ends (optional)</label><input id="endDate" name="endDate" type="date" className="input" /></div>
          <div className="sm:col-span-4"><button className="btn">Create subscription</button></div>
        </form>
      )}
    </div>
  );
}
