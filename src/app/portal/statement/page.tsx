import { requireClientUser } from "@/lib/auth";
import { clientStatement } from "@/lib/accounting";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PortalStatement() {
  const user = await requireClientUser();
  const st = await clientStatement(db, user.organizationId, user.clientId);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2"><h1 className="text-2xl font-semibold tracking-tight">Account statement</h1><span className="flex gap-2"><a className="btn-ghost" href="/portal/statement/csv">Download CSV</a><a className="btn" href="/portal/statement/pdf" target="_blank" rel="noopener">Download PDF</a></span></div>
      {st.advances.map((a) => <p key={a.currency} className="text-sm">Credit held on your account: <strong>{formatMoney(a.amount, a.currency)}</strong></p>)}
      <div className="card overflow-x-auto">
        {st.rows.length === 0 ? <p className="text-sm text-muted">No transactions yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Date</th><th className="pr-4">Document</th><th className="pr-4">Description</th><th className="pr-4 text-right">Charges</th><th className="pr-4 text-right">Payments</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {st.rows.map((r, i) => (
                <tr key={i} className="border-t border-border transition hover:bg-hover/50">
                  <td className="py-2 pr-4">{r.date.toLocaleDateString()}</td><td className="pr-4">{r.number}</td><td className="pr-4">{r.description}</td>
                  <td className="pr-4 text-right">{r.debit.gt(0) ? formatMoney(r.debit, r.currency) : ""}</td>
                  <td className="pr-4 text-right">{r.credit.gt(0) ? formatMoney(r.credit, r.currency) : ""}</td>
                  <td className="text-right font-medium">{formatMoney(r.balance, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
