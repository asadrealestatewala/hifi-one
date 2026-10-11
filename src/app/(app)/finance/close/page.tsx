import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { setPeriodLock } from "@/lib/bookkeeping";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";

export const dynamic = "force-dynamic";

async function lock(formData: FormData) {
  "use server";
  const user = await requirePermission("period.lock");
  const reason = String(formData.get("reason") ?? "");
  try {
    const before = await db.periodLock.findUnique({ where: { organizationId: user.organizationId } });
    const row = await setPeriodLock(db, { organizationId: user.organizationId, lockedThrough: String(formData.get("lockedThrough")), actorId: user.id, reopenReason: reason });
    await audit(user, { action: "period.lock", entity: "PeriodLock", before: before ? { lockedThrough: before.lockedThrough } : null, after: { lockedThrough: row.lockedThrough, reason: reason || undefined } });
    await db.settingChange.create({ data: { organizationId: user.organizationId, section: "period_lock", actorId: user.id, before: before ? { lockedThrough: before.lockedThrough } : undefined, after: { lockedThrough: row.lockedThrough, reason: reason || undefined } } });
  } catch (e) {
    if (e instanceof LedgerError) redirect(`/finance/close?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/finance/close?ok=1");
}

export default async function Close({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requirePermission("finance.view");
  const { error, ok } = await searchParams;
  const canLock = user.permissions.has("period.lock");
  const current = await db.periodLock.findUnique({ where: { organizationId: user.organizationId } });
  const history = await db.settingChange.findMany({ where: { organizationId: user.organizationId, section: "period_lock" }, orderBy: { createdAt: "desc" }, take: 10 });
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Close Accounting Periods</h1>
      <p className="text-sm text-muted">Closing a period stops anyone, from any module, from posting an entry dated on or before the closing date. Corrections after that go in the open period or need the period reopened with a written reason. This is not a year-end close: profit is not yet moved into retained earnings.</p>
      {ok && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">Saved.</p>}
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="card"><p className="text-sm">Books are closed through: <strong>{current?.lockedThrough ?? "not closed"}</strong></p></div>
      {canLock && (
        <form action={lock} className="card grid gap-3 sm:grid-cols-3">
          <div><label className="label" htmlFor="lockedThrough">Close through</label><input id="lockedThrough" name="lockedThrough" type="date" required className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="reason">Reason (required only to reopen an earlier date)</label><input id="reason" name="reason" className="input" /></div>
          <div className="sm:col-span-3"><button className="btn">Save</button></div>
        </form>
      )}
      <section className="card"><h2 className="font-semibold mb-2">History</h2>
        {history.length === 0 ? <p className="text-sm text-muted">No changes yet.</p> : (
          <ul className="text-sm">{history.map((h) => <li key={h.id} className="border-t border-border py-1 first:border-0">{h.createdAt.toLocaleString()}: {JSON.stringify((h.after as { lockedThrough?: string })?.lockedThrough)}{(h.after as { reason?: string })?.reason && ` (${(h.after as { reason?: string }).reason})`}</li>)}</ul>
        )}
      </section>
    </div>
  );
}
