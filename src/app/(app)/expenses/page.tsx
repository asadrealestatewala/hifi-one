import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ExpenseError, submitVoucher } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import { notifyPermission } from "@/lib/notifications";
import { listHref } from "@/lib/list-params";
import { EXPENSE_STATUSES as STATUSES, expenseParams, expenseScope, expenseWhere } from "@/lib/lists";
import { Chips, Empty, ExportLink, Notice, PageHeader, Pager, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

async function submit(formData: FormData) {
  "use server";
  const user = await requirePermission("self.expense");
  let id: string;
  try {
    const v = await submitVoucher(db, {
      organizationId: user.organizationId, submittedById: user.id, date: String(formData.get("date")), payee: String(formData.get("payee") ?? ""),
      description: String(formData.get("description") ?? ""), justification: String(formData.get("justification") ?? ""),
      expenseAccountId: String(formData.get("expenseAccountId")), projectId: String(formData.get("projectId") ?? "") || null,
      budgetId: String(formData.get("budgetId") ?? "") || null, currency: String(formData.get("currency")), amount: String(formData.get("amount") ?? ""),
    });
    id = v.id;
    await notifyPermission(db, user.organizationId, "expenses.review", { kind: "expense.submitted", title: `New expense voucher ${v.number}`, body: `${v.payee}: ${v.amount.toString()} ${v.currency}`, link: `/expenses/${v.id}`, dedupeKey: `expense-submitted:${v.id}` }, user.id);
    await audit(user, { action: "expense.submit", entity: "ExpenseVoucher", entityId: v.id, after: { number: v.number, amount: v.amount.toString(), currency: v.currency } });
  } catch (e) {
    if (e instanceof ExpenseError) redirect(`/expenses?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/expenses/${id}`);
}


export default async function Expenses({ searchParams }: { searchParams: Promise<{ error?: string; status?: string; page?: string }> }) {
  const user = await requirePermission("self.expense");
  const sp = await searchParams;
  const error = sp.error;
  const lp = expenseParams(sp);
  const status = lp.status;
  const all = user.permissions.has("expenses.view");
  const pg = lp.page;
  const mine = expenseScope(user);
  const where = expenseWhere(user, lp);
  const [vouchers, matched, counts, accounts, budgets, projects, people] = await Promise.all([
    db.expenseVoucher.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take }),
    db.expenseVoucher.count({ where }),
    db.expenseVoucher.groupBy({ by: ["status"], where: mine, _count: true }),
    db.account.findMany({ where: { organizationId: user.organizationId, active: true, type: { in: ["OPEX", "DIRECT_COST", "OTHER_EXPENSE"] } }, orderBy: { code: "asc" } }),
    db.budget.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } }),
    user.permissions.has("projects.view") ? db.project.findMany({ where: { organizationId: user.organizationId }, orderBy: { number: "asc" } }) : Promise.resolve([]),
    db.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const today = new Date().toISOString().slice(0, 10);
  const count = new Map(counts.map((c) => [c.status as string, c._count]));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/expenses${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-6">
      <PageHeader title="Expense Vouchers" subtitle={`${all ? "All vouchers in the organization." : "Your vouchers."} Approved spending is committed against its budget; posting records the expense; only payment moves cash.`} actions={<ExportLink href={listHref("/expenses/export", { status })} />} />
      <Chips current={status ?? "all"} items={[{ key: "all", label: "All", count: counts.reduce((n, c) => n + c._count, 0), href: href({ status: undefined }) }, ...STATUSES.map((s) => ({ key: s, label: s.toLowerCase().replace("_", " ").replace(/^./, (c) => c.toUpperCase()), count: count.get(s) ?? 0, href: href({ status: s }) }))]} />
      {vouchers.length === 0 ? <Empty title={status ? "No vouchers with this status" : "No vouchers yet"}>Submit one with the form below.</Empty> : (
      <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Number</th><th className="pr-4">Date</th><th className="pr-4">Payee</th><th className="pr-4">By</th><th className="pr-4 text-right">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {vouchers.map((v) => (
                <tr key={v.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/expenses/${v.id}`}>{v.number}</Link></td>
                  <td className="pr-4">{v.date}</td><td className="pr-4">{v.payee}</td><td className="pr-4">{name.get(v.submittedById)}</td>
                  <td className="pr-4 text-right tabular-nums">{formatMoney(v.amount, v.currency)}</td><td className="pr-4"><StatusBadge status={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
      </div>
      )}
      <form action={submit} className="card grid gap-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Submit a voucher</h2>
        {error && <div className="sm:col-span-2"><Notice kind="error">{error}</Notice></div>}
        <div><label className="label" htmlFor="payee">Payee</label><input id="payee" name="payee" required className="input" /></div>
        <div><label className="label" htmlFor="date">Expense date</label><input id="date" name="date" type="date" defaultValue={today} required className="input" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="description">Description</label><input id="description" name="description" required className="input" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="justification">Business justification</label><input id="justification" name="justification" className="input" /></div>
        <div><label className="label" htmlFor="expenseAccountId">Expense category (account)</label>
          <select id="expenseAccountId" name="expenseAccountId" required className="input"><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="amount">Amount</label><input id="amount" name="amount" required inputMode="decimal" className="input" /></div>
          <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
        </div>
        <div><label className="label" htmlFor="budgetId">Charge to budget (optional, same currency)</label>
          <select id="budgetId" name="budgetId" className="input"><option value="">No budget</option>{budgets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select></div>
        <div><label className="label" htmlFor="projectId">Project (optional)</label>
          <select id="projectId" name="projectId" className="input"><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select></div>
        <p className="sm:col-span-2 text-xs text-muted">Receipt attachments need file storage, which is not set up yet. Keep the receipt and reference it in the description.</p>
        <div className="sm:col-span-2"><button className="btn">Submit voucher</button></div>
      </form>
    </div>
  );
}
