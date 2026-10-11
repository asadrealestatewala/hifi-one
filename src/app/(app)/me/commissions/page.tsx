import { requirePermission } from "@/lib/auth";
import { statementFor } from "@/lib/commissions";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { EARNED: "waiting for approval", APPROVED: "approved, waiting to be paid", PAID: "paid" };

// Only ever shows the signed-in person's own entries.
export default async function MyCommissions() {
  const user = await requirePermission("commissions.own");
  const s = await statementFor(db, user.organizationId, user.id);
  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">My commissions</h1>
      {s.totals.size === 0 ? <div className="card text-sm text-muted">Nothing yet. Commissions appear here after clients you converted pay their invoices and a rate is set for you.</div> : (
        <div className="grid gap-3 sm:grid-cols-3">
          {[...s.totals].map(([cur, t]) => (
            <div key={cur} className="card text-sm space-y-1">
              <p className="font-semibold">{cur}</p>
              <p className="flex justify-between"><span>Waiting for approval</span><span>{formatMoney(t.earned.toString(), cur)}</span></p>
              <p className="flex justify-between"><span>Approved</span><span>{formatMoney(t.approved.toString(), cur)}</span></p>
              <p className="flex justify-between font-semibold"><span>Paid</span><span>{formatMoney(t.paid.toString(), cur)}</span></p>
            </div>
          ))}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-1 pr-3">Date</th><th className="pr-3">What</th><th className="pr-3 text-right">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {s.entries.map((e) => (
              <tr key={e.id} className="border-t border-border transition hover:bg-hover/50">
                <td className="py-1 pr-3">{e.createdAt.toLocaleDateString()}</td>
                <td className="pr-3">{e.kind === "BONUS" ? `Bonus: ${e.note}` : `${e.ratePercent.toString()}% of ${formatMoney(e.base, e.currency)} received`}</td>
                <td className="pr-3 text-right">{formatMoney(e.amount, e.currency)}</td><td>{LABEL[e.status] ?? e.status.toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
