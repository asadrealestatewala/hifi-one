import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { SalesError, createContract, daysUntil, expireContracts } from "@/lib/sales";

export const dynamic = "force-dynamic";
const today = () => new Date().toISOString().slice(0, 10);

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("contracts.manage");
  let id: string;
  try {
    const c = await createContract(db, {
      organizationId: user.organizationId, clientId: String(formData.get("clientId") ?? ""), title: String(formData.get("title") ?? ""),
      startDate: String(formData.get("startDate") ?? "") || null, endDate: String(formData.get("endDate") ?? "") || null,
      renewalNoticeDays: Number(formData.get("renewalNoticeDays") || 30), currency: String(formData.get("currency") ?? "") || null,
      value: String(formData.get("value") ?? "").trim() || null, notes: String(formData.get("notes") ?? "").trim() || null, createdById: user.id,
    });
    id = c.id;
    await audit(user, { action: "contract.create", entity: "Contract", entityId: c.id, after: { title: c.title } });
  } catch (e) {
    if (e instanceof SalesError) redirect(`/contracts?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/contracts/${id}`);
}

export default async function Contracts({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("contracts.view");
  const { error } = await searchParams;
  const org = user.organizationId;
  await expireContracts(db, org, today());
  const canManage = user.permissions.has("contracts.manage");
  const [contracts, clients] = await Promise.all([
    db.contract.findMany({ where: { organizationId: org }, orderBy: [{ endDate: "asc" }], include: { client: true } }),
    db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Contracts</h1>
      <div className="card overflow-x-auto">
        {contracts.length === 0 ? <p className="text-sm text-muted">No contracts yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Contract</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4">Ends</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {contracts.map((c) => {
                const left = c.status === "ACTIVE" && c.endDate ? daysUntil(c.endDate, today()) : null;
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2 pr-4"><Link className="hover:underline font-medium" href={`/contracts/${c.id}`}>{c.title}</Link></td>
                    <td className="pr-4">{c.client.name}</td><td className="pr-4">{c.status.toLowerCase()}</td>
                    <td className="pr-4">{c.endDate ?? ""}{left !== null && left <= c.renewalNoticeDays && <span className="ml-2 text-xs font-semibold text-brand">renewal due in {left} day{left === 1 ? "" : "s"}</span>}</td>
                    <td className="text-right">{c.value && c.currency ? formatMoney(c.value, c.currency) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {canManage && (
        <form action={create} className="card grid gap-4 sm:grid-cols-4">
          <h2 className="font-semibold sm:col-span-4">New contract (saved as draft; attach the signed document on the next page)</h2>
          {error && <p role="alert" className="sm:col-span-4 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="sm:col-span-2"><label className="label" htmlFor="title">Title</label><input id="title" name="title" required maxLength={160} className="input" placeholder="e.g. Master services agreement" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" required className="input"><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="startDate">Starts</label><input id="startDate" name="startDate" type="date" className="input" /></div>
          <div><label className="label" htmlFor="endDate">Ends</label><input id="endDate" name="endDate" type="date" className="input" /></div>
          <div><label className="label" htmlFor="renewalNoticeDays">Renewal reminder (days before)</label><input id="renewalNoticeDays" name="renewalNoticeDays" defaultValue="30" inputMode="numeric" className="input" /></div>
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="value">Value (optional)</label><input id="value" name="value" inputMode="decimal" className="input" /></div>
          </div>
          <div className="sm:col-span-4"><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} className="input" /></div>
          <div className="sm:col-span-4"><button className="btn">Save contract</button></div>
        </form>
      )}
    </div>
  );
}
