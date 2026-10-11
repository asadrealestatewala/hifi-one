import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PayrollError, createRun } from "@/lib/payroll";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("payroll.manage");
  const period = String(formData.get("period") ?? "");
  const currency = String(formData.get("currency") ?? "");
  try {
    const run = await createRun(db, { organizationId: user.organizationId, period, currency, createdById: user.id });
    await audit(user, { action: "payroll.create_run", entity: "PayrollRun", entityId: run.id, after: { period, currency } });
    redirect(`/payroll/${run.id}`);
  } catch (e) {
    if (e instanceof PayrollError || (e instanceof Error && e.message.startsWith("Period"))) redirect(`/payroll?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

export default async function Payroll({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("payroll.view");
  const { error } = await searchParams;
  const runs = await db.payrollRun.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ period: "desc" }, { currency: "asc" }], include: { items: true } });
  const canManage = user.permissions.has("payroll.manage");
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-2">
        <h1 className="text-2xl font-bold">Payroll</h1>
        <Link href="/payroll/structures" className="btn-ghost">Salary structures</Link>
      </div>
      <p className="text-sm text-muted">Tax is a flat percentage per employee for now. Replace it with your jurisdiction&apos;s rules before relying on it for filings.</p>
      <div className="card overflow-x-auto">
        {runs.length === 0 ? <p className="text-sm text-muted">No payroll runs yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Period</th><th className="pr-4">Currency</th><th className="pr-4">Employees</th><th className="pr-4 text-right">Net pay</th><th>Status</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 pr-4"><Link className="underline font-medium" href={`/payroll/${r.id}`}>{r.period}</Link></td>
                  <td className="pr-4">{r.currency}</td><td className="pr-4">{r.items.length}</td>
                  <td className="pr-4 text-right">{formatMoney(r.items.reduce((a, i) => a + Number(i.net), 0), r.currency)}</td><td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canManage && (
        <form action={create} className="card flex flex-wrap items-end gap-3">
          <h2 className="font-semibold w-full">Prepare a payroll run</h2>
          {error && <p role="alert" className="w-full text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          <div><label className="label" htmlFor="period">Month</label><input id="period" name="period" type="month" defaultValue={thisMonth} required className="input" /></div>
          <div><label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
          <button className="btn">Create run</button>
        </form>
      )}
    </div>
  );
}
