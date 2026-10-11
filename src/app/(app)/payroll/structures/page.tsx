import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PayrollError, setSalaryStructure } from "@/lib/payroll";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

async function save(formData: FormData) {
  "use server";
  const user = await requirePermission("payroll.manage");
  const userId = String(formData.get("userId"));
  const target = await db.employeeProfile.findFirst({ where: { userId, organizationId: user.organizationId } });
  if (!target) redirect("/payroll/structures?error=Employee+not+found");
  try {
    await setSalaryStructure(db, {
      userId, effectiveFrom: String(formData.get("effectiveFrom")), currency: String(formData.get("currency")),
      basic: String(formData.get("basic")), allowance: String(formData.get("allowance") || "0"), taxPercent: String(formData.get("taxPercent") || "0"), createdById: user.id,
    });
    await audit(user, { action: "payroll.set_salary_structure", entity: "SalaryStructure", entityId: userId }); // amounts are not copied into the log
  } catch (e) {
    if (e instanceof PayrollError) redirect(`/payroll/structures?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/payroll/structures");
}

export default async function Structures({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("payroll.view");
  const { error } = await searchParams;
  const canManage = user.permissions.has("payroll.manage");
  const profiles = await db.employeeProfile.findMany({ where: { organizationId: user.organizationId, status: "ACTIVE" }, orderBy: { employeeNo: "asc" } });
  const users = new Map((await db.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const structs = await db.salaryStructure.findMany({ where: { userId: { in: profiles.map((p) => p.userId) } }, orderBy: { effectiveFrom: "desc" } });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <Link href="/payroll" className="text-sm text-muted hover:underline">← Payroll</Link>
      <h1 className="text-2xl font-bold">Salary structures</h1>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Employee</th><th className="pr-4">Effective</th><th className="pr-4 text-right">Basic</th><th className="pr-4 text-right">Allowance</th><th className="text-right">Tax %</th></tr></thead>
          <tbody>
            {profiles.map((p) => {
              const s = structs.find((x) => x.userId === p.userId);
              return (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium">{users.get(p.userId)} <span className="text-xs text-muted">{p.employeeNo}</span></td>
                  <td className="pr-4">{s ? s.effectiveFrom : <em className="text-muted">not set</em>}</td>
                  <td className="pr-4 text-right">{s ? formatMoney(s.basic, s.currency) : ""}</td><td className="pr-4 text-right">{s ? formatMoney(s.allowance, s.currency) : ""}</td><td className="text-right">{s ? s.taxPercent.toString() : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canManage && (
        <form action={save} className="card grid gap-4 sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">Set salary (a new effective date keeps the old structure as history)</h2>
          <div><label className="label" htmlFor="userId">Employee</label>
            <select id="userId" name="userId" required className="input"><option value="">Choose…</option>{profiles.map((p) => <option key={p.id} value={p.userId}>{users.get(p.userId)}</option>)}</select></div>
          <div><label className="label" htmlFor="effectiveFrom">Effective from</label><input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} required className="input" /></div>
          <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label" htmlFor="basic">Basic salary</label><input id="basic" name="basic" required inputMode="decimal" className="input" /></div>
          <div><label className="label" htmlFor="allowance">Allowances</label><input id="allowance" name="allowance" inputMode="decimal" defaultValue="0" className="input" /></div>
          <div><label className="label" htmlFor="taxPercent">Tax withholding %</label><input id="taxPercent" name="taxPercent" inputMode="decimal" defaultValue="0" className="input" /></div>
          <div className="sm:col-span-3"><button className="btn">Save salary</button></div>
        </form>
      )}
    </div>
  );
}
