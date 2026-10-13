import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { LedgerError, recordPayment } from "@/lib/accounting";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Empty, NewButton, Notice, PageHeader, Pager, PanelForm, SearchBox, Stat } from "@/components/ui";
import { paging } from "@/lib/paging";
import Drawer from "@/components/ui/Drawer";
import { paymentReceived } from "@/lib/events";

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
  if (!parsed.success) redirect(`/finance/payments?new=1&error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  const d = parsed.data;
  let pid: string;
  try {
    const p = await recordPayment(db, {
      organizationId: user.organizationId, actorId: user.id, clientId: d.clientId, bankAccountId: d.bankAccountId,
      amount: d.amount, date: new Date(d.date), method: d.method, reference: d.reference || null, idempotencyKey: d.idempotencyKey,
    });
    pid = p.id;
    await audit(user, { action: "payment.record", entity: "Payment", entityId: p.id, after: { number: p.number, amount: p.amount.toString(), currency: p.currency } });
    await paymentReceived(db, { organizationId: user.organizationId, paymentId: p.id, actorId: user.id });
  } catch (e) {
    if (e instanceof LedgerError) redirect(`/finance/payments?new=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/finance/payments?ok=${pid}`);
}

export default async function Payments({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; q?: string; new?: string; page?: string }> }) {
  const user = await requirePermission("finance.view");
  const { error, ok, q, new: isNew, page } = await searchParams;
  const pg = paging(page);
  const canPost = user.permissions.has("finance.post");
  const search = q?.trim();
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
  // Default to today in the company timezone, not UTC, so receipts are not dated before their invoice
  const today = new Date().toLocaleDateString("en-CA", { timeZone: profile?.timezone ?? "UTC" });
  const open = Boolean(canPost && isNew);
  const org = user.organizationId;
  const where = { organizationId: org, ...(search ? { OR: [{ number: { contains: search, mode: "insensitive" as const } }, { client: { name: { contains: search, mode: "insensitive" as const } } }, { reference: { contains: search, mode: "insensitive" as const } }] } : {}) };
  // Figures come from aggregates over every payment, not from the page of rows shown
  const monthStart = today.slice(0, 7);
  const [payments, matched, received, advances, clients, banks] = await Promise.all([
    db.payment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take, include: { client: true, allocations: { include: { invoice: true } } } }),
    db.payment.count({ where }),
    db.payment.groupBy({ by: ["currency"], where: { organizationId: org, createdAt: { gte: new Date(`${monthStart}-01T00:00:00.000Z`) } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["currency"], where: { organizationId: org, unallocated: { gt: 0 } }, _sum: { unallocated: true } }),
    open ? db.client.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    open ? db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, ledgerAccountId: { not: null } }, orderBy: { internalName: "asc" } }) : Promise.resolve([]),
  ]);
  // Received this month and advances held, per currency, never mixed
  const perCurrency = (rows: { currency: string; v: { toString(): string } | null }[]) => rows.filter((r) => r.v && Number(r.v.toString()) !== 0).map((r) => formatMoney(r.v!, r.currency)).join(" · ") || "None";
  const total = await db.payment.count({ where: { organizationId: org } });
  return (
    <div className="space-y-5">
      <PageHeader title="Payments & receipts" subtitle="Money received, and which invoices it settled." actions={canPost ? <NewButton href="/finance/payments?new=1">Record payment</NewButton> : undefined} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Receipts" value={total} />
        <Stat label="Received this month" value={perCurrency(received.map((r) => ({ currency: r.currency, v: r._sum.amount })))} hint="per currency" />
        <Stat label="Held as advances" value={perCurrency(advances.map((r) => ({ currency: r.currency, v: r._sum.unallocated })))} hint="not yet applied to an invoice" />
      </div>
      {ok && <Notice kind="ok">Payment recorded and applied to open invoices, oldest first.</Notice>}
      {error && !open && <Notice kind="error">{error}</Notice>}
      <SearchBox q={search} placeholder="Search receipt, client or reference" />
      {payments.length === 0 ? <Empty title={search ? "No payments match" : "No payments yet"}>{canPost ? "Record the first one with Record payment." : "Receipts will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted">
              <tr><th className="px-4 py-2.5">Receipt</th><th className="pr-4">Client</th><th className="pr-4">Applied to</th><th className="pr-4 text-right">Amount</th><th className="pr-4 text-right">Held as advance</th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-3 font-medium"><a className="hover:underline" href={`/finance/payments/${p.id}/pdf`} target="_blank" rel="noopener">{p.number}</a></td>
                  <td className="pr-4">{p.client.name}</td>
                  <td className="pr-4">{p.allocations.map((a) => <Link key={a.id} href={`/finance/invoices/${a.invoiceId}`} className="mr-2 text-primary hover:underline">{a.invoice.number}</Link>)}</td>
                  <td className="pr-4 text-right tabular-nums">{formatMoney(p.amount, p.currency)}</td>
                  <td className="pr-4 text-right tabular-nums">{p.unallocated.gt(0) ? formatMoney(p.unallocated, p.currency) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => { const p = new URLSearchParams(); if (search) p.set("q", search); if (n > 1) p.set("page", String(n)); const t = p.toString(); return `/finance/payments${t ? `?${t}` : ""}`; }} />
        </div>
      )}
      {open && (
        <Drawer title="Record payment received" closeTo="/finance/payments">
          <PanelForm action={receive} closeTo="/finance/payments" submit="Record payment" error={error} hint="Applied to open invoices oldest first. Submitting twice records it once.">
            {/* Same key on refresh or double click means the payment is only recorded once */}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="clientId">Client</label>
                <select id="clientId" name="clientId" required className="input"><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label" htmlFor="bankAccountId">Received into</label>
                <select id="bankAccountId" name="bankAccountId" required className="input"><option value="">Choose…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.internalName} ({b.currency})</option>)}</select></div>
              <div><label className="label" htmlFor="amount">Amount (in the bank account currency)</label><input id="amount" name="amount" required inputMode="decimal" className="input" /></div>
              <div><label className="label" htmlFor="date">Date received</label><input id="date" name="date" type="date" required defaultValue={today} className="input" /></div>
              <div><label className="label" htmlFor="method">Method</label>
                <select id="method" name="method" className="input">{["BANK_TRANSFER", "CASH", "CARD", "CHEQUE", "OTHER"].map((m) => <option key={m}>{m}</option>)}</select></div>
              <div><label className="label" htmlFor="reference">Transaction reference</label><input id="reference" name="reference" className="input" /></div>
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
