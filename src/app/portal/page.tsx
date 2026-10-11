import Link from "next/link";
import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { portalInvoices, portalPayments, portalProjects } from "@/lib/portal";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", REVIEW: "In review", DONE: "Done" };

export default async function PortalHome() {
  const user = await requireClientUser();
  const [invoices, projects, payments] = await Promise.all([portalInvoices(db, user.clientId), portalProjects(db, user.clientId), portalPayments(db, user.clientId)]);
  const owed = new Map<string, number>();
  for (const i of invoices) owed.set(i.currency, (owed.get(i.currency) ?? 0) + Number(i.total.sub(i.amountPaid).sub(i.creditedAmount)));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Your account</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card"><p className="text-xs font-semibold text-muted">Outstanding</p>
          {owed.size === 0 ? <p className="text-2xl font-bold">Nothing due</p> : [...owed].map(([c, v]) => <p key={c} className="text-2xl font-bold">{formatMoney(v, c)}</p>)}
        </div>
        <div className="card"><p className="text-xs font-semibold text-muted">Invoices</p><p className="text-2xl font-bold">{invoices.length}</p></div>
        <div className="card"><p className="text-xs font-semibold text-muted">Active projects</p><p className="text-2xl font-bold">{projects.filter((p) => p.status === "ACTIVE").length}</p></div>
      </div>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Invoices</h2>
        {invoices.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Number</th><th className="pr-4">Due</th><th className="pr-4">Status</th><th className="pr-4 text-right">Total</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2 pr-4"><Link className="underline" href={`/portal/invoices/${i.id}`}>{i.number}</Link></td>
                  <td className="pr-4">{i.dueDate?.toLocaleDateString()}</td>
                  <td className="pr-4">{i.status.replace("_", " ")}</td>
                  <td className="pr-4 text-right">{formatMoney(i.total, i.currency)}</td>
                  <td className="text-right">{formatMoney(i.total.sub(i.amountPaid).sub(i.creditedAmount), i.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {payments.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-2">Payments and receipts</h2>
          <ul className="text-sm">{payments.map((p) => <li key={p.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><a className="underline" href={`/portal/receipts/${p.id}/pdf`} target="_blank" rel="noopener">{p.number}</a><span>{p.date.toLocaleDateString()} · {formatMoney(p.amount, p.currency)}</span></li>)}</ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">Projects</h2>
        {projects.length === 0 && <div className="card text-sm text-muted">No projects yet.</div>}
        {projects.map((p) => (
          <article key={p.id} className="card space-y-2">
            <div className="flex justify-between"><h3 className="font-semibold">{p.name}</h3><span className="text-sm text-muted">{p.status.replace("_", " ")} · {p.progress}%</span></div>
            <div className="h-2 rounded-full bg-border overflow-hidden"><div className="h-full bg-brand" style={{ width: `${p.progress}%` }} /></div>
            {p.tasks.length > 0 && (
              <ul className="text-sm">
                {p.tasks.map((t, i) => <li key={i} className="flex justify-between border-t border-border py-1"><span>{t.title}</span><span className="text-muted">{LABEL[t.status] ?? t.status}</span></li>)}
              </ul>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
