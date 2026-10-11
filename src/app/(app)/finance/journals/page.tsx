import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { approveManualJournal, createManualJournal, rejectManualJournal, reverseManualEntry, type ManualLine } from "@/lib/bookkeeping";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const fail = (m: string): never => redirect(`/finance/journals?error=${encodeURIComponent(m)}`);

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("journal.create");
  const lines: ManualLine[] = [];
  for (let i = 0; i < 8; i++) {
    const accountId = String(formData.get(`account${i}`) ?? "");
    const debit = String(formData.get(`debit${i}`) ?? "").trim();
    const credit = String(formData.get(`credit${i}`) ?? "").trim();
    if (!accountId && !debit && !credit) continue;
    if (!accountId) fail(`Line ${i + 1}: choose an account.`);
    lines.push({ accountId, debit: debit || undefined, credit: credit || undefined, memo: String(formData.get(`memo${i}`) ?? "").trim() || undefined });
  }
  try {
    const j = await createManualJournal(db, { organizationId: user.organizationId, date: String(formData.get("date")), memo: String(formData.get("memo") ?? ""), currency: String(formData.get("currency")), lines, createdById: user.id });
    await audit(user, { action: "journal.prepare", entity: "ManualJournal", entityId: j.id, after: { memo: j.memo } });
  } catch (e) {
    if (e instanceof LedgerError) fail(e.message);
    throw e;
  }
  redirect("/finance/journals");
}

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("journal.approve");
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  try {
    if (op === "approve") await approveManualJournal(db, { organizationId: user.organizationId, id, approverId: user.id });
    else if (op === "reject") await rejectManualJournal(db, { organizationId: user.organizationId, id, deciderId: user.id, note: String(formData.get("note") ?? "") });
    else if (op === "reverse") await reverseManualEntry(db, { organizationId: user.organizationId, entryId: id, actorId: user.id, reason: String(formData.get("note") ?? "") });
    else redirect("/finance/journals");
    await audit(user, { action: `journal.${op}`, entity: op === "reverse" ? "JournalEntry" : "ManualJournal", entityId: id });
  } catch (e) {
    if (e instanceof LedgerError) fail(e.message);
    throw e;
  }
  redirect("/finance/journals");
}

export default async function Journals({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("finance.view");
  const { error } = await searchParams;
  const canCreate = user.permissions.has("journal.create");
  const canApprove = user.permissions.has("journal.approve");
  const org = user.organizationId;
  const [journals, accounts, manualEntries, lock, people] = await Promise.all([
    db.manualJournal.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.account.findMany({ where: { organizationId: org, active: true, OR: [{ systemKey: null }, { systemKey: { notIn: ["AR", "ACCOUNTS_PAYABLE", "CUSTOMER_ADVANCES"] } }] }, orderBy: { code: "asc" } }),
    db.journalEntry.findMany({ where: { organizationId: org, sourceType: "MANUAL" }, orderBy: { createdAt: "desc" }, take: 30, include: { lines: { include: { account: true } } } }),
    db.periodLock.findUnique({ where: { organizationId: org } }),
    db.user.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
  ]);
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? "";
  const acct = new Map((await db.account.findMany({ where: { organizationId: org }, select: { id: true, code: true, name: true } })).map((a) => [a.id, a]));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Manual Journal Entries</h1>
      <p className="text-sm text-muted">Prepared by one person and posted by another. Control accounts (receivables, payables, customer advances) are closed to manual entries: use invoices, payments, credit notes and refunds. {lock && <>Books are closed through <strong>{lock.lockedThrough}</strong>.</>}</p>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}

      <section className="card space-y-2">
        <h2 className="font-semibold">Entries</h2>
        {journals.length === 0 && <p className="text-sm text-muted">None yet.</p>}
        {journals.map((j) => {
          const lines = j.lines as unknown as ManualLine[];
          return (
            <div key={j.id} className="border-t border-border pt-2 text-sm space-y-1 first:border-0 first:pt-0">
              <p><strong>{j.date}</strong> · {j.memo} · {j.currency} · <span className={j.status === "PENDING" ? "text-brand font-semibold" : "text-muted"}>{j.status.toLowerCase()}</span> · prepared by {name(j.createdById)}</p>
              <ul className="text-xs text-muted">{lines.map((l, i) => <li key={i}>{acct.get(l.accountId)?.code} {acct.get(l.accountId)?.name}: {l.debit ? `Dr ${formatMoney(l.debit, j.currency)}` : `Cr ${formatMoney(l.credit ?? 0, j.currency)}`}</li>)}</ul>
              {j.decisionNote && <p className="text-xs text-muted">Note: {j.decisionNote}</p>}
              {j.status === "PENDING" && canApprove && j.createdById !== user.id && (
                <div className="flex flex-wrap gap-2">
                  <form action={decide}><input type="hidden" name="id" value={j.id} /><input type="hidden" name="op" value="approve" /><button className="btn">Approve and post</button></form>
                  <form action={decide} className="flex gap-1"><input type="hidden" name="id" value={j.id} /><input type="hidden" name="op" value="reject" /><input name="note" required placeholder="Reason" aria-label="Reason for rejecting" className="input !w-48" /><button className="btn-ghost">Reject</button></form>
                </div>
              )}
              {j.status === "PENDING" && j.createdById === user.id && <p className="text-xs text-muted">Waiting for a second person to approve.</p>}
            </div>
          );
        })}
      </section>

      {canApprove && manualEntries.some((e) => e.status === "POSTED") && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Reverse a posted manual entry</h2>
          {manualEntries.filter((e) => e.status === "POSTED").map((e) => (
            <form key={e.id} action={decide} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm first:border-0">
              <input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="reverse" />
              <span className="font-medium">{e.number}</span><span className="text-muted">{e.memo}</span>
              <input name="note" required placeholder="Reason for reversal" aria-label="Reason for reversal" className="input !w-56" /><button className="btn-ghost">Reverse</button>
            </form>
          ))}
        </section>
      )}

      {canCreate && (
        <form action={create} className="card space-y-3">
          <h2 className="font-semibold">Prepare an entry</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><label className="label" htmlFor="date">Date</label><input id="date" name="date" type="date" defaultValue={today} required className="input" /></div>
            <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["USD", "PKR", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="memo">Why is this entry needed?</label><input id="memo" name="memo" required className="input" /></div>
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="grid gap-2 grid-cols-[1fr_7rem_7rem_1fr]">
                <select name={`account${i}`} aria-label={`Line ${i + 1} account`} className="input"><option value="">{i < 2 ? "Account…" : "Account (optional)"}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
                <input name={`debit${i}`} placeholder="Debit" aria-label={`Line ${i + 1} debit`} inputMode="decimal" className="input" />
                <input name={`credit${i}`} placeholder="Credit" aria-label={`Line ${i + 1} credit`} inputMode="decimal" className="input" />
                <input name={`memo${i}`} placeholder="Line note" aria-label={`Line ${i + 1} note`} className="input" />
              </div>
            ))}
          </div>
          <button className="btn">Submit for approval</button>
        </form>
      )}
    </div>
  );
}
