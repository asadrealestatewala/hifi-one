import { requireVendorUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { vendorLedger } from "@/lib/vendors";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function VendorStatement() {
  const user = await requireVendorUser();
  const rows = await vendorLedger(db, user.organizationId, user.vendorId); // scoped to this vendor only
  return (
    <div className="space-y-4">
      <PageHeader title="Statement" actions={<span className="flex gap-2"><a className="btn-ghost" href="/vendor/ledger/csv">Download CSV</a><a className="btn" href="/vendor/ledger/pdf" target="_blank" rel="noopener">Download PDF</a></span>} />
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <p className="text-sm text-muted">No approved bills or payments yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Date</th><th className="pr-4">Document</th><th className="pr-4">Description</th><th className="pr-4 text-right">Billed</th><th className="pr-4 text-right">Paid</th><th className="text-right">Balance due to you</th></tr></thead>
            <tbody>
              {rows.map((l, i) => (
                <tr key={i} className="border-t border-border transition hover:bg-hover/50">
                  <td className="py-2 pr-4">{l.date.toLocaleDateString()}</td><td className="pr-4">{l.number}</td><td className="pr-4">{l.description}</td>
                  <td className="pr-4 text-right">{l.billed.gt(0) ? formatMoney(l.billed, l.currency) : ""}</td><td className="pr-4 text-right">{l.paid.gt(0) ? formatMoney(l.paid, l.currency) : ""}</td>
                  <td className="text-right font-medium">{formatMoney(l.balance, l.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
