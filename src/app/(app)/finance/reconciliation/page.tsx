import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { BankError, acceptSuggestions, clearOpeningBalance, importStatement, matchLines, postStatementLine, reconcile, reconciliationView, unmatch } from "@/lib/bank-rec";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const back = (bank: string, kind: "error" | "msg", m: string) => redirect(`/finance/reconciliation?bank=${bank}&${kind}=${encodeURIComponent(m)}`);

async function act(formData: FormData) {
  "use server";
  const bank = String(formData.get("bank") ?? "");
  const op = String(formData.get("op") ?? "");
  const user = await requirePermission("bank.reconcile");
  const org = user.organizationId;
  const s = (k: string) => String(formData.get(k) ?? "");
  try {
    if (op === "import") {
      const file = formData.get("file");
      const text = file instanceof File && file.size > 0 ? await file.text() : s("csv");
      if (text.length > 2_000_000) return back(bank, "error", "That file is too large.");
      const r = await importStatement(db, { organizationId: org, bankAccountId: bank, csv: text, actorId: user.id });
      await audit(user, { action: "bank.import", entity: "BankAccount", entityId: bank, after: r });
      return back(bank, "msg", `${r.added} line${r.added === 1 ? "" : "s"} added, ${r.skipped} already imported.`);
    }
    if (op === "match") {
      await matchLines(db, { organizationId: org, bankAccountId: bank, statementLineId: s("statementLineId"), journalLineId: s("journalLineId"), actorId: user.id });
      await audit(user, { action: "bank.match", entity: "BankAccount", entityId: bank, after: { statementLineId: s("statementLineId"), journalLineId: s("journalLineId") } });
    } else if (op === "accept") {
      const n = await acceptSuggestions(db, { organizationId: org, bankAccountId: bank, actorId: user.id });
      await audit(user, { action: "bank.match_suggested", entity: "BankAccount", entityId: bank, after: { matched: n } });
      return back(bank, "msg", `${n} suggested match${n === 1 ? "" : "es"} confirmed.`);
    } else if (op === "unmatch") {
      await unmatch(db, { organizationId: org, matchId: s("matchId") });
      await audit(user, { action: "bank.unmatch", entity: "BankAccount", entityId: bank, after: { matchId: s("matchId") } });
    } else if (op === "post") {
      await requirePermission("finance.post");
      const e = await postStatementLine(db, { organizationId: org, bankAccountId: bank, statementLineId: s("statementLineId"), counterAccountId: s("counterAccountId"), actorId: user.id });
      await audit(user, { action: "bank.post_line", entity: "JournalEntry", entityId: e.id, after: { statementLineId: s("statementLineId") } });
      return back(bank, "msg", `Posted ${e.number} and matched it.`);
    } else if (op === "opening") {
      const n = await clearOpeningBalance(db, { organizationId: org, bankAccountId: bank, throughDate: s("throughDate"), actorId: user.id });
      await audit(user, { action: "bank.opening", entity: "BankAccount", entityId: bank, after: { cleared: n, through: s("throughDate") } });
      return back(bank, "msg", `${n} older ledger line${n === 1 ? "" : "s"} treated as part of the opening position.`);
    } else if (op === "reconcile") {
      const r = await reconcile(db, { organizationId: org, bankAccountId: bank, statementDate: s("statementDate"), statementBalance: s("statementBalance"), actorId: user.id });
      await audit(user, { action: "bank.reconcile", entity: "BankReconciliation", entityId: r.id, after: { statementDate: r.statementDate, statementBalance: r.statementBalance.toString() } });
      return back(bank, "msg", `Reconciled as at ${r.statementDate}.`);
    }
  } catch (e) {
    if (e instanceof BankError) return back(bank, "error", e.message);
    throw e;
  }
  redirect(`/finance/reconciliation?bank=${bank}`);
}

export default async function Reconciliation({ searchParams }: { searchParams: Promise<{ bank?: string; error?: string; msg?: string }> }) {
  const user = await requirePermission("bank.reconcile");
  const sp = await searchParams;
  const org = user.organizationId;
  const canPost = user.permissions.has("finance.post");
  const banks = await db.bankAccount.findMany({ where: { organizationId: org, active: true }, orderBy: { internalName: "asc" } });
  const selected = banks.find((b) => b.id === sp.bank);
  const flash = (<>
    {sp.msg && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">{sp.msg}</p>}
    {sp.error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{sp.error}</p>}
  </>);

  if (!selected) {
    const last = await db.bankReconciliation.findMany({ where: { organizationId: org }, orderBy: { statementDate: "desc" } });
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Bank Reconciliation</h1>
        <p className="text-sm text-muted">Compare the bank statement with the books. Import the statement, match each line to a ledger entry, post anything missing (like bank charges), then confirm the closing balance.</p>
        {flash}
        <div className="card">
          {banks.length === 0 ? <p className="text-sm text-muted">No bank accounts yet.</p> : (
            <ul className="text-sm">
              {banks.map((b) => {
                const l = last.find((r) => r.bankAccountId === b.id);
                return (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-0">
                    <span><strong>{b.internalName}</strong> <span className="text-muted">({b.currency}){!b.ledgerAccountId && " · not linked to a ledger account"}</span></span>
                    <span className="text-muted">{l ? `Last reconciled to ${l.statementDate}` : "Never reconciled"}</span>
                    {b.ledgerAccountId ? <Link className="btn-ghost" href={`/finance/reconciliation?bank=${b.id}`}>Open</Link> : <span className="text-xs">Link it in Bank Accounts first</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const v = await reconciliationView(db, org, selected.id);
  const accounts = canPost ? await db.account.findMany({ where: { organizationId: org, active: true, id: { not: selected.ledgerAccountId ?? "" } }, orderBy: { code: "asc" } }) : [];
  const history = await db.bankReconciliation.findMany({ where: { organizationId: org, bankAccountId: selected.id }, orderBy: { statementDate: "desc" }, take: 5 });
  const cur = selected.currency;
  const hid = (op: string, extra: Record<string, string> = {}) => (<><input type="hidden" name="bank" value={selected.id} /><input type="hidden" name="op" value={op} />{Object.entries(extra).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}</>);
  const matches = await db.bankMatch.findMany({ where: { organizationId: org, bankAccountId: selected.id, kind: "STATEMENT" }, orderBy: { createdAt: "desc" }, take: 10 });
  const stmtById = new Map((await db.bankStatementLine.findMany({ where: { id: { in: matches.map((m) => m.statementLineId!).filter(Boolean) } } })).map((x) => [x.id, x]));

  return (
    <div className="space-y-5">
      <Link href="/finance/reconciliation" className="text-sm text-muted hover:underline">← Bank accounts</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Reconcile {selected.internalName} <span className="text-base font-normal text-muted">({cur}) · books show {formatMoney(v.ledgerBalance.toString(), cur)}</span></h1>
      {flash}

      <section className="card space-y-3">
        <h2 className="font-semibold">1. Import the bank statement</h2>
        <p className="text-xs text-muted">CSV with a header row naming <em>date</em>, <em>description</em> and either <em>amount</em> (money out as negative) or <em>money in</em> and <em>money out</em>. Dates as 2026-03-31 or 31/03/2026. Importing the same lines again is safe: duplicates are skipped.</p>
        <form action={act} encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
          {hid("import")}
          <div><label className="label" htmlFor="file">CSV file</label><input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" className="input" /></div>
          <button className="btn">Import</button>
        </form>
        <details><summary className="text-sm cursor-pointer">Or paste the lines</summary>
          <form action={act} className="mt-2 space-y-2">{hid("import")}<textarea name="csv" rows={5} aria-label="Statement lines" className="input font-mono text-xs" placeholder={"date,description,amount\n2026-03-02,Client payment,1500.00\n2026-03-05,Bank charges,-12.50"} /><button className="btn-ghost">Import pasted lines</button></form>
        </details>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">2. Match statement lines to the books</h2>
          {v.suggestions.length > 0 && <form action={act}>{hid("accept")}<button className="btn">Confirm {v.suggestions.length} suggested match{v.suggestions.length === 1 ? "" : "es"}</button></form>}
        </div>
        <p className="text-xs text-muted">Suggestions are only made when exactly one entry has the same amount within 7 days. Anything unclear is left for you.</p>
        {v.unmatchedStmt.length === 0 ? <p className="text-sm text-muted">Every imported statement line is matched.</p> : (
          <ul className="text-sm space-y-3">
            {v.unmatchedStmt.map((s) => {
              const cands = v.unmatchedLedger.filter((l) => l.amount.eq(s.amount.toString()));
              return (
                <li key={s.id} className="border-t border-border pt-2 first:border-0">
                  <div className="flex justify-between gap-2"><span>{s.date} · {s.description}{s.reference && <span className="text-muted"> · {s.reference}</span>}</span><strong>{formatMoney(s.amount.toString(), cur)}</strong></div>
                  <div className="mt-1 flex flex-wrap gap-2 items-center">
                    {cands.length > 0 && (
                      <form action={act} className="flex gap-2 items-center">
                        {hid("match", { statementLineId: s.id })}
                        <select name="journalLineId" aria-label="Matching ledger entry" className="input !w-72">{cands.map((l) => <option key={l.id} value={l.id}>{l.date} · {l.number} · {l.memo}</option>)}</select>
                        <button className="btn-ghost">Match</button>
                      </form>
                    )}
                    {canPost && (
                      <form action={act} className="flex gap-2 items-center">
                        {hid("post", { statementLineId: s.id })}
                        <select name="counterAccountId" required aria-label="Post to account" className="input !w-64"><option value="">Not in the books: post to…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
                        <button className="btn-ghost">Post and match</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {matches.length > 0 && (
          <details><summary className="text-sm cursor-pointer">Recent matches</summary>
            <ul className="mt-2 text-sm">{matches.map((m) => { const st = m.statementLineId ? stmtById.get(m.statementLineId) : null; return (
              <li key={m.id} className="flex justify-between border-t border-border py-1"><span>{st?.date} · {st?.description}</span>
                <span>{st && formatMoney(st.amount.toString(), cur)} {m.reconciliationId ? <em className="text-muted">reconciled</em> : <form action={act} className="inline">{hid("unmatch", { matchId: m.id })}<button className="underline text-xs">Undo</button></form>}</span></li>); })}</ul>
          </details>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Books entries not on the statement ({v.unmatchedLedger.length})</h2>
        {v.unmatchedLedger.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <ul className="text-sm">{v.unmatchedLedger.slice(-25).map((l) => <li key={l.id} className="flex justify-between border-t border-border py-1 first:border-0"><span>{l.date} · {l.number} · {l.memo}</span><span>{formatMoney(l.amount.toString(), cur)}</span></li>)}</ul>
        )}
        {history.length === 0 && v.unmatchedLedger.length > 0 && (
          <form action={act} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            {hid("opening")}
            <div><label className="label" htmlFor="throughDate">First time? Treat entries up to this date as already agreed with the bank</label><input id="throughDate" name="throughDate" type="date" required className="input" /></div>
            <button className="btn-ghost">Set opening position</button>
          </form>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">3. Confirm the closing balance</h2>
        <form action={act} className="flex flex-wrap items-end gap-3">
          {hid("reconcile")}
          <div><label className="label" htmlFor="statementDate">Statement date</label><input id="statementDate" name="statementDate" type="date" required className="input" /></div>
          <div><label className="label" htmlFor="statementBalance">Closing balance on the statement</label><input id="statementBalance" name="statementBalance" required inputMode="decimal" className="input" /></div>
          <button className="btn">Reconcile</button>
        </form>
        <p className="text-xs text-muted">Passes only when the statement balance equals the books, less entries not yet on the statement, plus statement lines not yet in the books. Anything else is a difference to investigate.</p>
        {history.length > 0 && <ul className="text-sm">{history.map((r) => <li key={r.id} className="border-t border-border py-1">Reconciled to {r.statementDate}: statement {formatMoney(r.statementBalance.toString(), cur)}, {formatMoney(r.outstandingLedger.toString(), cur)} outstanding in the books</li>)}</ul>}
      </section>
    </div>
  );
}
