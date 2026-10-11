import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { clientStatement } from "@/lib/accounting";
import EmailDocForm from "@/components/EmailDocForm";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import InviteForm from "./InviteForm";
import RefundForm from "./RefundForm";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; mailOk?: string; mailError?: string }> }) {
  const user = await requirePermission("clients.view");
  const { id } = await params;
  const sp = await searchParams;
  const { error } = sp;
  const client = await db.client.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!client) notFound();
  const canSeeFinance = user.permissions.has("finance.view");
  const banks = user.permissions.has("finance.refund") ? await db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, ledgerAccountId: { not: null } } }) : [];
  const [statement, invoices] = canSeeFinance
    ? await Promise.all([
        clientStatement(db, user.organizationId, client.id),
        db.invoice.findMany({ where: { clientId: client.id, status: { not: "DRAFT" } }, orderBy: { issueDate: "desc" } }),
      ])
    : [null, []];
  return (
    <div className="space-y-6">
      <Link href="/clients" className="text-sm text-muted hover:underline">← All clients</Link>
      <h1 className="text-2xl font-bold">{client.name} <span className="text-muted text-base font-normal">{client.code}</span></h1>
      <section className="card text-sm grid grid-cols-3 gap-y-2 max-w-2xl">
        {([["Email", client.email], ["Phone", client.phone], ["Country", client.country], ["Tax ID", client.taxId],
          ["Billing currency", client.currency], ["Payment terms", `${client.paymentTermsDays} days`], ["Address", client.billingAddress]] as [string, string | null][]).map(([k, v]) => (
          <div key={k} className="contents"><span className="text-muted">{k}</span><span className="col-span-2">{v ?? ""}</span></div>
        ))}
      </section>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      {user.permissions.has("clients.edit") && <InviteForm clientId={client.id} />}
      {user.permissions.has("finance.refund") && statement?.advances.map((a) => (
        <RefundForm key={a.currency} clientId={client.id} currency={a.currency} held={a.amount.toString()} banks={banks.filter((b) => b.currency === a.currency).map((b) => ({ id: b.id, name: b.internalName }))} />
      ))}
      {statement && (
        <section className="card overflow-x-auto space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Account statement</h2><a className="btn-ghost" href={`/clients/${client.id}/statement/pdf`} target="_blank" rel="noopener">Statement PDF</a></div>
          {user.permissions.has("finance.post") && <EmailDocForm kind="STATEMENT" id={client.id} defaultTo={client.email} returnTo={`/clients/${client.id}`} flash={{ mailOk: sp.mailOk, mailError: sp.mailError }} label="Email the statement" />}
          {statement.advances.map((a) => (
            <p key={a.currency} className="text-sm">Advance held on account: <strong>{formatMoney(a.amount, a.currency)}</strong></p>
          ))}
          {statement.rows.length === 0 ? (
            <p className="text-sm text-muted">No transactions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-2 pr-4">Date</th><th className="pr-4">Document</th><th className="pr-4">Description</th><th className="pr-4 text-right">Debit</th><th className="pr-4 text-right">Credit</th><th className="text-right">Balance</th></tr>
              </thead>
              <tbody>
                {statement.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-2 pr-4 whitespace-nowrap">{r.date.toLocaleDateString()}</td>
                    <td className="pr-4">{r.number}</td>
                    <td className="pr-4">{r.description}</td>
                    <td className="pr-4 text-right">{r.debit.gt(0) ? formatMoney(r.debit, r.currency) : ""}</td>
                    <td className="pr-4 text-right">{r.credit.gt(0) ? formatMoney(r.credit, r.currency) : ""}</td>
                    <td className="text-right font-medium">{formatMoney(r.balance, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {invoices.length > 0 && (
            <p className="text-sm text-muted">
              Invoices: {invoices.map((i) => (
                <Link key={i.id} href={`/finance/invoices/${i.id}`} className="underline mr-3">{i.number}</Link>
              ))}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
