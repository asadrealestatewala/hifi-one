import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Notice, PageHeader, Stat } from "@/components/ui";
import { ExpenseError, budgetStatus, createBudget, decideTransfer, requestTransfer } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import { notifyPermission } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const fail = (m: string): never => redirect(`/finance/budgets?error=${encodeURIComponent(m)}`);

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("budget.manage");
  try {
    const b = await createBudget(db, {
      organizationId: user.organizationId, name: String(formData.get("name") ?? ""), scope: String(formData.get("scope")), projectId: String(formData.get("projectId") ?? "") || null,
      periodStart: String(formData.get("periodStart")), periodEnd: String(formData.get("periodEnd")), currency: String(formData.get("currency")), amount: String(formData.get("amount") ?? ""), createdById: user.id,
    });
    await audit(user, { action: "budget.create", entity: "Budget", entityId: b.id, after: { name: b.name, amount: b.originalAmount.toString(), currency: b.currency } });
  } catch (e) {
    if (e instanceof ExpenseError) fail(e.message);
    throw e;
  }
  redirect("/finance/budgets");
}

async function transfer(formData: FormData) {
  "use server";
  const user = await requirePermission("budget.manage");
  try {
    const t = await requestTransfer(db, {
      organizationId: user.organizationId, fromBudgetId: String(formData.get("from")), toBudgetId: String(formData.get("to")),
      amount: String(formData.get("amount") ?? ""), reason: String(formData.get("reason") ?? ""), requestedById: user.id,
    });
    await audit(user, { action: "budget.transfer_request", entity: "BudgetTransfer", entityId: t.id, after: { amount: t.amount.toString() } });
    await notifyPermission(db, user.organizationId, "budget.approve", { kind: "budget.transfer", title: "A budget transfer needs approval", body: t.reason, link: "/finance/budgets", dedupeKey: `budget-transfer:${t.id}` }, user.id);
  } catch (e) {
    if (e instanceof ExpenseError) fail(e.message);
    throw e;
  }
  redirect("/finance/budgets");
}

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("budget.approve");
  const approve = formData.get("decision") === "approve";
  try {
    await decideTransfer(db, { organizationId: user.organizationId, id: String(formData.get("id")), approverId: user.id, approve });
    await audit(user, { action: approve ? "budget.transfer_approve" : "budget.transfer_reject", entity: "BudgetTransfer", entityId: String(formData.get("id")) });
  } catch (e) {
    if (e instanceof ExpenseError) fail(e.message);
    throw e;
  }
  redirect("/finance/budgets");
}

export default async function Budgets({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("budget.view");
  const { error } = await searchParams;
  const budgets = await db.budget.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } });
  const statuses = await Promise.all(budgets.map((b) => budgetStatus(db, b.id)));
  const projects = await db.project.findMany({ where: { organizationId: user.organizationId }, orderBy: { number: "asc" } });
  const transfers = await db.budgetTransfer.findMany({ where: { from: { organizationId: user.organizationId } }, orderBy: { createdAt: "desc" }, take: 30, include: { from: true, to: true } });
  const canManage = user.permissions.has("budget.manage");
  const canApprove = user.permissions.has("budget.approve");
  return (
    <div className="space-y-6">
      <PageHeader title="Budgets" subtitle="Each budget keeps its original amount. Approved transfers adjust what is available. Warnings show at 75%, 90% and 100%. Committed means approved but not yet posted; incurred means posted or paid." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Budgets" value={statuses.length} />
        <Stat label="Nearing the limit" value={statuses.filter((x) => x.level >= 75 && !x.over).length} hint="75% or more used" />
        <Stat label="Over budget" value={statuses.filter((x) => x.over).length} />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid gap-4 md:grid-cols-2">
        {statuses.length === 0 && <div className="card text-sm text-muted">No budgets yet.</div>}
        {statuses.map((s) => {
          const color = s.level >= 100 ? "bg-brand" : s.level >= 90 ? "bg-orange-500" : s.level >= 75 ? "bg-yellow-500" : "bg-green-600";
          const cur = s.budget.currency;
          return (
            <article key={s.budget.id} className="card space-y-2">
              <div className="flex justify-between"><h2 className="font-semibold">{s.budget.name}</h2><span className="text-xs text-muted">{s.budget.scope.toLowerCase()} · {s.budget.periodStart} to {s.budget.periodEnd}</span></div>
              <div className="h-2 rounded-full bg-border overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, s.pct)}%` }} /></div>
              <p className="text-sm">{s.pct}% used{s.level >= 75 && <strong className="text-brand"> · {s.over ? "over budget" : `warning at ${s.level}%`}</strong>}</p>
              <dl className="grid grid-cols-2 text-xs gap-y-0.5">
                <dt className="text-muted">Original</dt><dd className="text-right">{formatMoney(s.budget.originalAmount, cur)}</dd>
                <dt className="text-muted">Available after transfers</dt><dd className="text-right">{formatMoney(s.effective, cur)}</dd>
                <dt className="text-muted">Committed</dt><dd className="text-right">{formatMoney(s.committed, cur)}</dd>
                <dt className="text-muted">Incurred</dt><dd className="text-right">{formatMoney(s.incurred, cur)}</dd>
                <dt className="text-muted font-semibold">Remaining</dt><dd className="text-right font-semibold">{formatMoney(s.remaining, cur)}</dd>
              </dl>
            </article>
          );
        })}
      </div>

      {canManage && (
        <>
          <form action={create} className="card grid gap-4 sm:grid-cols-3">
            <h2 className="font-semibold sm:col-span-3">New budget</h2>
            <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" required className="input" /></div>
            <div><label className="label" htmlFor="scope">Scope</label>
              <select id="scope" name="scope" className="input"><option value="COMPANY">Company</option><option value="DEPARTMENT">Department</option><option value="PROJECT">Project</option></select></div>
            <div><label className="label" htmlFor="projectId">Project (for project budgets)</label>
              <select id="projectId" name="projectId" className="input"><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></div>
            <div><label className="label" htmlFor="periodStart">From</label><input id="periodStart" name="periodStart" type="date" required className="input" /></div>
            <div><label className="label" htmlFor="periodEnd">To</label><input id="periodEnd" name="periodEnd" type="date" required className="input" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="amount">Amount</label><input id="amount" name="amount" required inputMode="decimal" className="input" /></div>
              <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
            </div>
            <div className="sm:col-span-3"><button className="btn">Create budget</button></div>
          </form>

          <form action={transfer} className="card grid gap-4 sm:grid-cols-4">
            <h2 className="font-semibold sm:col-span-4">Request a transfer between budgets (needs a second person to approve)</h2>
            <div><label className="label" htmlFor="from">From</label><select id="from" name="from" required className="input"><option value="">Choose…</option>{budgets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select></div>
            <div><label className="label" htmlFor="to">To</label><select id="to" name="to" required className="input"><option value="">Choose…</option>{budgets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select></div>
            <div><label className="label" htmlFor="tamount">Amount</label><input id="tamount" name="amount" required inputMode="decimal" className="input" /></div>
            <div><label className="label" htmlFor="reason">Reason</label><input id="reason" name="reason" required className="input" /></div>
            <div className="sm:col-span-4"><button className="btn">Request transfer</button></div>
          </form>
        </>
      )}

      <section className="card space-y-2">
        <h2 className="font-semibold">Transfers</h2>
        {transfers.length === 0 && <p className="text-sm text-muted">No transfers.</p>}
        {transfers.map((t) => (
          <form key={t.id} action={decide} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
            <input type="hidden" name="id" value={t.id} />
            <span>{formatMoney(t.amount, t.from.currency)} from <strong>{t.from.name}</strong> to <strong>{t.to.name}</strong>: {t.reason}</span>
            <span className="text-muted">{t.status.toLowerCase()}</span>
            {t.status === "PENDING" && canApprove && t.requestedById !== user.id && (
              <><button name="decision" value="approve" className="btn">Approve</button><button name="decision" value="reject" className="btn-ghost">Reject</button></>
            )}
          </form>
        ))}
      </section>
    </div>
  );
}
