import { requirePermission } from "@/lib/auth";
import { trialBalance } from "@/lib/accounting";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function Ledger() {
  const user = await requirePermission("finance.view");
  const [accounts, tb, entries] = await Promise.all([
    db.account.findMany({ where: { organizationId: user.organizationId }, orderBy: { code: "asc" } }),
    trialBalance(db, user.organizationId),
    db.journalEntry.findMany({
      where: { organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 30,
      include: { lines: { include: { account: true } } },
    }),
  ]);
  const currencies = [...new Set(tb.map((r) => r.currency))];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">General Ledger</h1>
      <p className="text-sm text-muted">
        Balances are shown per currency. Cross-currency consolidation arrives with exchange rates, so no totals are mixed across currencies here.
      </p>
      {currencies.length === 0 && <div className="card text-sm text-muted">No postings yet. Issue an invoice or record a payment.</div>}
      {currencies.map((cur) => {
        const rows = tb.filter((r) => r.currency === cur);
        const dr = rows.reduce((a, r) => a + Number(r.debit), 0);
        const cr = rows.reduce((a, r) => a + Number(r.credit), 0);
        return (
          <section key={cur} className="card overflow-x-auto">
            <h2 className="font-semibold mb-2">Trial balance, {cur}</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Code</th><th className="pr-4">Account</th><th className="pr-4 text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className="border-t border-border">
                    <td className="py-1.5 pr-4 text-muted">{r.code}</td><td className="pr-4">{r.name}</td>
                    <td className="pr-4 text-right">{formatMoney(r.debit, cur)}</td><td className="text-right">{formatMoney(r.credit, cur)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-bold">
                  <td /><td className="pr-4">Total {dr === cr ? "(balanced)" : "(OUT OF BALANCE)"}</td>
                  <td className="pr-4 text-right">{formatMoney(dr, cur)}</td><td className="text-right">{formatMoney(cr, cur)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Recent journal entries</h2>
        {entries.map((e) => (
          <div key={e.id} className="border-t border-border py-2 text-sm">
            <p><span className="font-medium">{e.number}</span> · {e.date.toLocaleDateString()} · {e.memo} {e.status === "REVERSED" && <em className="text-muted">(reversed)</em>}</p>
            <ul className="text-xs text-muted">
              {e.lines.map((l) => (
                <li key={l.id}>{l.account.code} {l.account.name}: {l.debit.gt(0) ? `Dr ${formatMoney(l.debit, e.currency)}` : `Cr ${formatMoney(l.credit, e.currency)}`}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section className="card">
        <h2 className="font-semibold mb-2">Chart of accounts</h2>
        <ul className="grid sm:grid-cols-2 text-sm gap-x-6">
          {accounts.map((a) => <li key={a.id}><span className="text-muted">{a.code}</span> {a.name} <span className="text-xs text-muted">({a.type.replace("_", " ").toLowerCase()})</span></li>)}
        </ul>
      </section>
    </div>
  );
}
