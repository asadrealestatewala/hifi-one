import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { LedgerError, recordPayment } from "@/lib/accounting";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a positive amount"),
  date: z.string().min(1),
  method: z.enum(["BANK_TRANSFER", "CASH", "CARD", "CHEQUE", "OTHER"]),
  reference: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().min(8),
});

async function receive(formData: FormData) {
  "use server";
  const user = await requirePermission("finance.post");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/finance/payments?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  const d = parsed.data;
  let pid: string;
  try {
    const p = await recordPayment(db, {
      organizationId: user.organizationId, actorId: user.id, clientId: d.clientId, bankAccountId: d.bankAccountId,
      amount: d.amount, date: new Date(d.date), method: d.method, reference: d.reference || null, idempotencyKey: d.idempotencyKey,
    });
    pid = p.id;
    await audit(user, { action: "payment.record", entity: "Payment", entityId: p.id, after: { number: p.number, amount: p.amount.toString(), currency: p.currency } });
  } catch (e) {
    if (e instanceof LedgerError) redirect(`/finance/payments?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/finance/payments?ok=${pid}`);
}

export default async function Payments({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requirePermission("finance.view");
  const { error, ok } = await searchParams;
  const canPost = user.permissions.has("finance.post");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
  // Default to today in the company timezone, not UTC, so receipts are not dated before their invoice
  const today = new Date().toLocaleDateString("en-CA", { timeZone: profile?.timezone ?? "UTC" });
  const [payments, clients, banks] = await Promise.all([
    db.payment.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 100, include: { client: true, allocations: { include: { invoice: true } } } }),
    db.client.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
    db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, ledgerAccountId: { not: null } }, orderBy: { internalName: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payments & Receipts</h1>
      {ok && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">Payment recorded and applied to open invoices, oldest first.</p>}
      <div className="card overflow-x-auto">
        {payments.length === 0 ? <p className="text-sm text-muted">No payments yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-2 pr-4">Receipt</th><th className="pr-4">Client</th><th className="pr-4">Applied to</th><th className="pr-4 text-right">Amount</th><th className="text-right">Held as advance</th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium">{p.number}</td>
                  <td className="pr-4">{p.client.name}</td>
                  <td className="pr-4">
                    {p.allocations.map((a) => (
                      <Link key={a.id} href={`/finance/invoices/${a.invoiceId}`} className="underline mr-2">{a.invoice.number}</Link>
                    ))}
                  </td>
                  <td className="pr-4 text-right">{formatMoney(p.amount, p.currency)}</td>
                  <td className="text-right">{p.unallocated.gt(0) ? formatMoney(p.unallocated, p.currency) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canPost && (
        <form action={receive} className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Record payment received</h2>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          {/* Same key on refresh or double click means the payment is only recorded once */}
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" required className="input">
              <option value="">Choose…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bankAccountId">Received into</label>
            <select id="bankAccountId" name="bankAccountId" required className="input">
              <option value="">Choose…</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.internalName} ({b.currency})</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="amount">Amount (in the bank account currency)</label>
            <input id="amount" name="amount" required inputMode="decimal" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="date">Date received</label>
            <input id="date" name="date" type="date" required defaultValue={today} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="method">Method</label>
            <select id="method" name="method" className="input">
              {["BANK_TRANSFER", "CASH", "CARD", "CHEQUE", "OTHER"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reference">Transaction reference</label>
            <input id="reference" name="reference" className="input" />
          </div>
          <div className="sm:col-span-2"><button className="btn">Record payment</button></div>
        </form>
      )}
    </div>
  );
}
