import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import { ExpenseError, approveVoucher, budgetStatus, cancelVoucher, payVoucher, postVoucher, rejectVoucher, reviewVoucher } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import { notify, notifyPermission } from "@/lib/notifications";
import FilesPanel from "@/components/FilesPanel";
import { ConfirmButton } from "@/components/ui";

export const dynamic = "force-dynamic";

const need = { review: "expenses.review", approve: "expenses.approve", reject: "expenses.review", post: "expenses.post", pay: "expenses.post", cancel: "self.expense" } as const;

async function step(formData: FormData) {
  "use server";
  const which = String(formData.get("step")) as keyof typeof need;
  const id = String(formData.get("id"));
  if (!(which in need)) redirect(`/expenses/${id}`);
  const user = await requirePermission(need[which]);
  const o = user.organizationId;
  try {
    if (which === "review") await reviewVoucher(db, { organizationId: o, id, reviewerId: user.id });
    else if (which === "approve") {
      await approveVoucher(db, { organizationId: o, id, approverId: user.id, canOverride: user.permissions.has("budget.override"), overrideReason: String(formData.get("note") ?? "") });
    } else if (which === "reject") {
      if (!user.permissions.has("expenses.approve") && !user.permissions.has("expenses.review")) redirect("/forbidden");
      await rejectVoucher(db, { organizationId: o, id, actorId: user.id, note: String(formData.get("note") ?? "") });
    } else if (which === "post") await postVoucher(db, { organizationId: o, id, actorId: user.id });
    else if (which === "pay") await payVoucher(db, { organizationId: o, id, bankAccountId: String(formData.get("bankAccountId")), actorId: user.id });
    else if (which === "cancel") await cancelVoucher(db, { organizationId: o, id, userId: user.id });
    await audit(user, { action: `expense.${which}`, entity: "ExpenseVoucher", entityId: id });
    const v = await db.expenseVoucher.findUnique({ where: { id } });
    if (v) {
      const text: Record<string, string> = { approve: "was approved", reject: "was rejected", post: "was posted", pay: "was paid" };
      if (text[which]) await notify(db, v.submittedById, { kind: `expense.${which}`, title: `Your expense ${v.number} ${text[which]}`, link: `/expenses/${v.id}`, dedupeKey: `expense:${v.id}:${which}` });
      if (which === "review") await notifyPermission(db, user.organizationId, "expenses.approve", { kind: "expense.review", title: `Voucher ${v.number} is ready to approve`, link: `/expenses/${v.id}`, dedupeKey: `expense-review:${v.id}` }, v.submittedById);
    }
  } catch (e) {
    if (e instanceof ExpenseError || e instanceof LedgerError) redirect(`/expenses/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/expenses/${id}`);
}

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; fileError?: string; fileOk?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error, fileError, fileOk } = await searchParams;
  const v = await db.expenseVoucher.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!v) notFound();
  const mine = v.submittedById === user.id;
  if (!mine && !user.permissions.has("expenses.view")) notFound(); // others' vouchers stay private
  const [people, acct, budget, banks, project] = await Promise.all([
    db.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } }),
    db.account.findUnique({ where: { id: v.expenseAccountId } }),
    v.budgetId ? budgetStatus(db, v.budgetId) : Promise.resolve(null),
    db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, currency: v.currency, ledgerAccountId: { not: null } } }),
    v.projectId ? db.project.findUnique({ where: { id: v.projectId } }) : Promise.resolve(null),
  ]);
  const name = (i: string | null) => people.find((p) => p.id === i)?.name ?? "";
  const can = (p: Parameters<typeof user.permissions.has>[0]) => user.permissions.has(p);
  // Each form gets its own hidden fields: the voucher id and the workflow step (not relying on button name/value)
  const f = (stepName: string) => (
    <>
      <input type="hidden" name="id" value={v.id} />
      <input type="hidden" name="step" value={stepName} />
    </>
  );
  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/expenses" className="text-sm text-muted hover:underline">← All vouchers</Link>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <article className="card space-y-3">
        <div className="flex justify-end"><a className="btn-ghost" href={`/expenses/${v.id}/voucher`} target="_blank" rel="noopener">Voucher PDF</a></div>
        <h1 className="text-xl font-bold">{v.number} <span className="text-base font-normal text-muted">{v.status.replace("_", " ")}</span></h1>
        <dl className="grid grid-cols-3 gap-y-1 text-sm">
          {([["Payee", v.payee], ["Date", v.date], ["Description", v.description], ["Justification", v.justification], ["Category", acct ? `${acct.code} ${acct.name}` : ""],
            ["Amount", formatMoney(v.amount, v.currency)], ["Project", project ? `${project.number} ${project.name}` : null], ["Submitted by", name(v.submittedById)],
            ["Reviewed by", name(v.reviewedById)], ["Approved by", name(v.approvedById)], ["Paid by", name(v.paidById)], ["Decision note", v.decisionNote],
            ["Over-budget reason", v.overBudgetReason]] as [string, string | null][]).filter(([, x]) => x).map(([k, x]) => (
            <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="col-span-2">{x}</dd></div>
          ))}
        </dl>
        {budget && (
          <p className="text-sm rounded-lg bg-border/40 px-3 py-2">
            Budget <strong>{budget.budget.name}</strong>: {formatMoney(budget.effective, v.currency)} available in total, {formatMoney(budget.committed, v.currency)} committed,
            {" "}{formatMoney(budget.incurred, v.currency)} incurred, {formatMoney(budget.remaining, v.currency)} remaining ({budget.pct}% used){budget.over && " · OVER BUDGET"}.
          </p>
        )}
      </article>
      <FilesPanel user={user} ownerType="EXPENSE" ownerId={v.id} returnTo={`/expenses/${v.id}`} title="Receipts and supporting documents" flash={{ fileError, fileOk }} />
      <div className="card flex flex-wrap items-end gap-2">
        {v.status === "SUBMITTED" && can("expenses.review") && !mine && <form action={step}>{f("review")}<button className="btn">Take into review</button></form>}
        {v.status === "SUBMITTED" && mine && <form action={step}>{f("cancel")}<ConfirmButton title="Cancel this voucher?" message="It is withdrawn and cannot be approved later; submit a new one if needed." confirmLabel="Cancel voucher">Cancel voucher</ConfirmButton></form>}
        {v.status === "UNDER_REVIEW" && can("expenses.approve") && !mine && (
          <form action={step} className="flex gap-2 items-end">{f("approve")}
            <input name="note" placeholder="Reason (needed if over budget)" aria-label="Approval note" className="input w-64" />
            <button className="btn">Approve</button>
          </form>
        )}
        {["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(v.status) && (can("expenses.approve") || can("expenses.review")) && (
          <form action={step} className="flex gap-2 items-end">{f("reject")}
            <input name="note" placeholder="Reason for rejecting" aria-label="Rejection reason" className="input w-56" required />
            <button className="btn-ghost">Reject</button>
          </form>
        )}
        {v.status === "APPROVED" && can("expenses.post") && <form action={step}>{f("post")}<button className="btn">Post to ledger</button></form>}
        {v.status === "POSTED" && can("expenses.post") && (
          <form action={step} className="flex gap-2 items-end">{f("pay")}
            <select name="bankAccountId" required aria-label="Paid from" className="input"><option value="">Paid from…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.internalName}</option>)}</select>
            <button className="btn">Record payment</button>
          </form>
        )}
        {v.status === "PAID" && <p className="text-sm">Paid. No further action.</p>}
      </div>
    </div>
  );
}
