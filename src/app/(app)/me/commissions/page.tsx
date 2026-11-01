import { requirePermission } from "@/lib/auth";
import { campaignRates, statementFor } from "@/lib/commissions";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { EARNED: "waiting for approval", APPROVED: "approved, waiting to be paid", PAID: "paid" };

// Only ever shows the signed-in person's own entries.
export default async function MyCommissions() {
  const user = await requirePermission("commissions.own");
  const [s, rates] = await Promise.all([statementFor(db, user.organizationId, user.id), campaignRates(db, user.organizationId)]);
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title="My commissions" />
      {rates.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">What each campaign pays</h2>
          <p className="text-xs text-muted">Earned on the revenue (before tax) of every client you close, as the client pays. Managers earn the manager share on their team&apos;s clients.</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Campaign</th><th className="pr-3 text-right">Sales agent</th><th className="text-right">Sales manager</th></tr></thead>
            <tbody>{rates.map((r) => <tr key={r.campaignId} className="border-t border-border"><td className="py-1.5 pr-3">{r.campaign}{r.category ? <span className="text-xs text-muted"> · {r.category}</span> : null}</td><td className="pr-3 text-right font-medium">{r.agent ? `${r.agent}%` : "–"}</td><td className="text-right font-medium">{r.manager ? `${r.manager}%` : "–"}</td></tr>)}</tbody>
          </table>
        </section>
      )}
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
                <td className="pr-3">{e.kind === "BONUS" ? `Bonus: ${e.note}` : `${e.role === "SALES_MANAGER" ? "Manager share: " : ""}${e.ratePercent.toString()}% of ${formatMoney(e.base, e.currency)} received`}</td>
                <td className="pr-3 text-right">{formatMoney(e.amount, e.currency)}</td><td>{LABEL[e.status] ?? e.status.toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
