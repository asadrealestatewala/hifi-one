import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { portalInvoice } from "@/lib/portal";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

type Snap = Record<string, string | null>;

export default async function PortalInvoice({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireClientUser();
  const { id } = await params;
  const inv = await portalInvoice(db, user.clientId, id); // scoped to this client, or null
  if (!inv) notFound();
  const co = inv.companySnapshot as Snap | null;
  const bank = inv.bankSnapshot as Snap | null;
  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center print:hidden">
        <Link href="/portal" className="text-sm text-muted hover:underline">← Back</Link>
        <PrintButton />
      </div>
      <article className="card space-y-6">
        <header className="flex justify-between gap-4">
          <div><h1 className="text-2xl font-bold">INVOICE</h1><p className="text-sm text-muted">{inv.number} · {inv.status.replace("_", " ")}</p></div>
          <div className="text-right text-sm"><p className="font-semibold">{co?.legalName}</p><p className="text-muted max-w-xs">{co?.registeredOffice}</p></div>
        </header>
        <p className="text-sm">Issued {inv.issueDate?.toLocaleDateString()} · Due {inv.dueDate?.toLocaleDateString()}</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2">Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-t border-border"><td className="py-2">{l.description}</td><td className="text-right">{l.quantity.toString()}</td>
                <td className="text-right">{formatMoney(l.unitPrice, inv.currency)}</td><td className="text-right">{formatMoney(l.amount, inv.currency)}</td></tr>
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
        {bank && (
          <section className="text-sm border-t border-border pt-4">
            <p className="label">How to pay</p>
            <p>{bank.bankName} · {bank.accountHolder}</p>
            <p>Account: {bank.accountNumber}{bank.iban ? ` · IBAN: ${bank.iban}` : ""}{bank.swift ? ` · SWIFT: ${bank.swift}` : ""}</p>
            {bank.paymentInstructions && <p className="text-muted">{bank.paymentInstructions}</p>}
          </section>
        )}
        {co?.invoiceFooter && <p className="text-xs text-muted border-t border-border pt-3">{co.invoiceFooter}</p>}
      </article>
    </div>
  );
}
