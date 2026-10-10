import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { cancelInvoice, issueInvoice, LedgerError } from "@/lib/accounting";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

async function issue(formData: FormData) {
  "use server";
  const user = await requirePermission("finance.post");
  const id = String(formData.get("id"));
  try {
    const inv = await issueInvoice(db, { organizationId: user.organizationId, invoiceId: id, actorId: user.id });
    await audit(user, { action: "invoice.issue", entity: "Invoice", entityId: id, after: { number: inv.number, total: inv.total.toString() } });
  } catch (e) {
    if (e instanceof LedgerError) redirect(`/finance/invoices/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/finance/invoices/${id}`);
}

async function cancel(formData: FormData) {
  "use server";
  const user = await requirePermission("finance.post");
  const id = String(formData.get("id"));
  try {
    await cancelInvoice(db, { organizationId: user.organizationId, invoiceId: id, actorId: user.id });
    await audit(user, { action: "invoice.cancel", entity: "Invoice", entityId: id });
  } catch (e) {
    if (e instanceof LedgerError) redirect(`/finance/invoices/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/finance/invoices/${id}`);
}

type Snap = Record<string, string | null>;

export default async function InvoicePage({
  params,
  searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("finance.view");
  const { id } = await params;
  const { error } = await searchParams;
  const inv = await db.invoice.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { client: true, lines: true, allocations: { include: { payment: true } } },
  });
  if (!inv) notFound();
  const canPost = user.permissions.has("finance.post");
  // Issued invoices show the frozen snapshot; drafts show current company details.
  const live = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
  const co = (inv.companySnapshot as Snap | null) ?? (live as unknown as Snap | null);
  const bank = inv.bankSnapshot as Snap | null;
  return (
    <div className="space-y-4">
      <Link href="/finance/invoices" className="text-sm text-muted hover:underline print:hidden">← All invoices</Link>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 print:hidden">
        {inv.status === "DRAFT" && canPost && (
          <form action={issue}><input type="hidden" name="id" value={inv.id} /><button className="btn">Issue invoice</button></form>
        )}
        {(inv.status === "ISSUED" || inv.status === "DRAFT") && canPost && (
          <form action={cancel}><input type="hidden" name="id" value={inv.id} /><button className="btn-ghost">Cancel invoice</button></form>
        )}
        <PrintButton />
      </div>
      <article className="card max-w-3xl space-y-6">
        <header className="flex justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">INVOICE</h1>
            <p className="text-sm text-muted">{inv.number ?? "Draft (not issued)"} · {inv.status.replace("_", " ")}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{co?.legalName}</p>
            <p className="text-muted max-w-xs">{co?.registeredOffice}</p>
            <p className="text-muted">{[co?.globalUan, co?.localUan].filter(Boolean).join(" · ")}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="label">Bill to</p>
            <p className="font-medium">{inv.client.name}</p>
            <p className="text-muted whitespace-pre-line">{inv.client.billingAddress}</p>
          </div>
          <div className="text-right">
            <p>Issue date: {inv.issueDate ? inv.issueDate.toLocaleDateString() : "-"}</p>
            <p>Due date: {inv.dueDate ? inv.dueDate.toLocaleDateString() : "-"}</p>
          </div>
        </section>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2">Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="py-2">{l.description}</td>
                <td className="text-right">{l.quantity.toString()}</td>
                <td className="text-right">{formatMoney(l.unitPrice, inv.currency)}</td>
                <td className="text-right">{formatMoney(l.amount, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto w-64 text-sm space-y-1">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(inv.subtotal, inv.currency)}</dd></div>
          <div className="flex justify-between"><dt>Tax ({inv.taxRate.toString()}%)</dt><dd>{formatMoney(inv.taxAmount, inv.currency)}</dd></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><dt>Total</dt><dd>{formatMoney(inv.total, inv.currency)}</dd></div>
          <div className="flex justify-between"><dt>Paid</dt><dd>{formatMoney(inv.amountPaid, inv.currency)}</dd></div>
          <div className="flex justify-between font-bold"><dt>Balance due</dt><dd>{formatMoney(inv.total.sub(inv.amountPaid), inv.currency)}</dd></div>
        </dl>
        {bank ? (
          <section className="text-sm border-t border-border pt-4">
            <p className="label">Payment instructions</p>
            <p>{bank.bankName} · {bank.accountHolder}</p>
            <p>Account: {bank.accountNumber}{bank.iban ? ` · IBAN: ${bank.iban}` : ""}{bank.swift ? ` · SWIFT: ${bank.swift}` : ""}</p>
            {bank.paymentInstructions && <p className="text-muted">{bank.paymentInstructions}</p>}
          </section>
        ) : inv.status !== "DRAFT" ? (
          <p className="text-sm text-muted border-t border-border pt-4">No default bank account existed for {inv.currency} when this invoice was issued.</p>
        ) : null}
        {inv.notes && <p className="text-sm text-muted">{inv.notes}</p>}
        {co?.invoiceFooter && <p className="text-xs text-muted border-t border-border pt-3">{co.invoiceFooter}</p>}
        {inv.allocations.length > 0 && (
          <section className="text-sm print:hidden">
            <p className="label">Payments received</p>
            <ul>{inv.allocations.map((a) => <li key={a.id}>{a.payment.number}: {formatMoney(a.amount, inv.currency)}</li>)}</ul>
          </section>
        )}
      </article>
    </div>
  );
}
