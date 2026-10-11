import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import { PayrollError, approveRun, payRun, postRun, setBonus } from "@/lib/payroll";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

function fail(id: string, m: string): never {
  redirect(`/payroll/${id}?error=${encodeURIComponent(m)}`);
}
const isKnown = (e: unknown) => e instanceof PayrollError || e instanceof LedgerError;

async function bonus(formData: FormData) {
  "use server";
  const user = await requirePermission("payroll.manage");
  const runId = String(formData.get("runId"));
  try {
    await setBonus(db, { organizationId: user.organizationId, runId, userId: String(formData.get("userId")), bonus: String(formData.get("bonus") || "0") });
    await audit(user, { action: "payroll.set_bonus", entity: "PayrollRun", entityId: runId, after: { userId: String(formData.get("userId")) } });
  } catch (e) {
    if (isKnown(e)) fail(runId, (e as Error).message);
    throw e;
  }
  redirect(`/payroll/${runId}`);
}

async function step(formData: FormData) {
  "use server";
  const which = String(formData.get("step"));
  const runId = String(formData.get("runId"));
  const need = which === "approve" ? "payroll.approve" : "payroll.post";
  const user = await requirePermission(need);
  try {
    if (which === "approve") await approveRun(db, { organizationId: user.organizationId, runId, approverId: user.id });
    else if (which === "post") await postRun(db, { organizationId: user.organizationId, runId, actorId: user.id });
    else if (which === "pay") await payRun(db, { organizationId: user.organizationId, runId, bankAccountId: String(formData.get("bankAccountId")), actorId: user.id });
    await audit(user, { action: `payroll.${which}`, entity: "PayrollRun", entityId: runId });
  } catch (e) {
    if (isKnown(e)) fail(runId, (e as Error).message);
    throw e;
  }
  redirect(`/payroll/${runId}`);
}

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("payroll.view");
  const { id } = await params;
  const { error } = await searchParams;
  const run = await db.payrollRun.findFirst({ where: { id, organizationId: user.organizationId }, include: { items: true } });
  if (!run) notFound();
  const [people, banks] = await Promise.all([
    db.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } }),
    db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, currency: run.currency, ledgerAccountId: { not: null } } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const { items, currency } = run;
  const sum = (f: (i: (typeof items)[number]) => unknown) => items.reduce((a, i) => a + Number(f(i)), 0);
  const m = (v: number) => formatMoney(v, currency);
  const draft = run.status === "DRAFT";
  const can = (p: Parameters<typeof user.permissions.has>[0]) => user.permissions.has(p);
  return (
    <div className="space-y-6">
      <Link href="/payroll" className="text-sm text-muted hover:underline">← All payroll runs</Link>
      <h1 className="text-2xl font-bold">Payroll {run.period} <span className="text-base font-normal text-muted">{run.currency} · {run.status}</span></h1>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr>
            <th className="py-2 pr-3">Employee</th><th className="pr-3 text-right">Basic</th><th className="pr-3 text-right">Allowance</th><th className="pr-3 text-right">Bonus</th>
            <th className="pr-3 text-right">Unpaid leave</th><th className="pr-3 text-right">Gross</th><th className="pr-3 text-right">Tax</th><th className="text-right">Net</th></tr></thead>
          <tbody>
            {run.items.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="py-2 pr-3 font-medium"><Link className="hover:underline" href={`/payslips/${i.id}`}>{name.get(i.userId)}</Link></td>
                <td className="pr-3 text-right">{m(Number(i.basic))}</td><td className="pr-3 text-right">{m(Number(i.allowance))}</td>
                <td className="pr-3 text-right">
                  {draft && can("payroll.manage") ? (
                    <form action={bonus} className="flex gap-1 justify-end">
                      <input type="hidden" name="runId" value={run.id} /><input type="hidden" name="userId" value={i.userId} />
                      <input name="bonus" defaultValue={i.bonus.toString()} aria-label={`Bonus for ${name.get(i.userId)}`} className="input !w-24 !py-1 text-right" />
                      <button className="btn-ghost">Set</button>
                    </form>
                  ) : m(Number(i.bonus))}
                </td>
                <td className="pr-3 text-right">−{m(Number(i.unpaidDeduction))} <span className="text-xs text-muted">({i.unpaidDays.toString()}d)</span></td>
                <td className="pr-3 text-right">{m(Number(i.gross))}</td><td className="pr-3 text-right">{m(Number(i.tax))}</td><td className="text-right font-semibold">{m(Number(i.net))}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-bold"><td className="py-2">Total</td><td /><td /><td /><td />
              <td className="pr-3 text-right">{m(sum((i) => i.gross))}</td><td className="pr-3 text-right">{m(sum((i) => i.tax))}</td><td className="text-right">{m(sum((i) => i.net))}</td></tr>
          </tbody>
        </table>
      </div>
      <section className="card space-y-3">
        <h2 className="font-semibold">Workflow</h2>
        <p className="text-sm text-muted">Draft, then approved by a different person (the run is then frozen), then posted to the ledger, then salary payment recorded.</p>
        <div className="flex flex-wrap gap-2">
          {run.status === "DRAFT" && can("payroll.approve") && (
            <form action={step}><input type="hidden" name="runId" value={run.id} /><button name="step" value="approve" className="btn">Approve run</button></form>
          )}
          {run.status === "APPROVED" && can("payroll.post") && (
            <form action={step}><input type="hidden" name="runId" value={run.id} /><button name="step" value="post" className="btn">Post to ledger</button></form>
          )}
          {run.status === "POSTED" && can("payroll.post") && (
            <form action={step} className="flex gap-2 items-end">
              <input type="hidden" name="runId" value={run.id} />
              <div><label className="label" htmlFor="bankAccountId">Paid from</label>
                <select id="bankAccountId" name="bankAccountId" required className="input"><option value="">Choose…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.internalName}</option>)}</select></div>
              <button name="step" value="pay" className="btn">Record salary payment</button>
            </form>
          )}
          {run.status === "PAID" && <p className="text-sm">Paid {run.paidAt?.toLocaleDateString()}.</p>}
        </div>
      </section>
    </div>
  );
}
