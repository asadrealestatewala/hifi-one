import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { SalesError, cancelQuote, convertQuoteToInvoice, decideQuote, expireQuotes, sendQuote } from "@/lib/sales";

export const dynamic = "force-dynamic";

async function act(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const op = String(formData.get("op") ?? "");
  const needed = op === "convert" ? "finance.post" : "quotes.manage";
  const user = await requirePermission(needed);
  if (op === "convert") await requirePermission("quotes.manage");
  const org = user.organizationId;
  const today = new Date().toISOString().slice(0, 10);
  const back = (q: string) => redirect(`/quotes/${id}${q}`);
  try {
    if (op === "send") await sendQuote(db, { organizationId: org, quoteId: id });
    else if (op === "cancel") await cancelQuote(db, { organizationId: org, quoteId: id });
    else if (op === "accept" || op === "decline") {
      await decideQuote(db, { organizationId: org, quoteId: id, decision: op === "accept" ? "ACCEPT" : "DECLINE", byUserId: user.id, via: "STAFF", note: String(formData.get("note") ?? ""), today });
    } else if (op === "convert") {
      const r = await convertQuoteToInvoice(db, { organizationId: org, quoteId: id, actorId: user.id });
      await audit(user, { action: "quote.convert", entity: "Quote", entityId: id, after: { invoiceId: r.invoiceId } });
      redirect(`/finance/invoices/${r.invoiceId}`);
    } else back("?error=Unknown%20action");
    await audit(user, { action: `quote.${op}`, entity: "Quote", entityId: id });
  } catch (e) {
    if (e instanceof SalesError) return back(`?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back("");
}

export default async function QuoteDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("quotes.view");
  const { id } = await params;
  const { error } = await searchParams;
  await expireQuotes(db, user.organizationId, new Date().toISOString().slice(0, 10));
  const q = await db.quote.findFirst({ where: { id, organizationId: user.organizationId }, include: { client: true, lines: true } });
  if (!q) notFound();
  const canManage = user.permissions.has("quotes.manage");
  const canInvoice = canManage && user.permissions.has("finance.post");
  const hid = <input type="hidden" name="id" value={q.id} />;
  const form = (op: string, label: string, ghost = false) => (
    <form action={act}>{hid}<input type="hidden" name="op" value={op} /><button className={ghost ? "btn-ghost" : "btn"}>{label}</button></form>
  );
  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/quotes" className="text-sm text-muted hover:underline">← Quotations</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{q.number} <span className="text-base font-normal text-muted">{q.status.toLowerCase()}</span></h1>
        <a className="btn-ghost" href={`/quotes/${q.id}/pdf`} target="_blank" rel="noopener">Download PDF</a>
      </div>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <section className="card space-y-3">
        <p className="text-sm">For <strong>{q.client.name}</strong>{q.validUntil && <> · valid until {q.validUntil}</>}</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Description</th><th className="pr-4 text-right">Qty</th><th className="pr-4 text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{q.lines.map((l) => <tr key={l.id} className="border-t border-border"><td className="py-2 pr-4">{l.description}</td><td className="pr-4 text-right">{l.quantity.toString()}</td><td className="pr-4 text-right">{formatMoney(l.unitPrice, q.currency)}</td><td className="text-right">{formatMoney(l.amount, q.currency)}</td></tr>)}</tbody>
        </table>
        <dl className="text-sm ml-auto w-64 space-y-1">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(q.subtotal, q.currency)}</dd></div>
          <div className="flex justify-between"><dt>Tax ({q.taxRate.toString()}%)</dt><dd>{formatMoney(q.taxAmount, q.currency)}</dd></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><dt>Total</dt><dd>{formatMoney(q.total, q.currency)}</dd></div>
        </dl>
        {q.notes && <p className="text-sm whitespace-pre-line text-muted">{q.notes}</p>}
        {q.terms && <p className="text-sm whitespace-pre-line"><strong>Terms:</strong> {q.terms}</p>}
        {q.decidedAt && <p className="text-sm text-muted">{q.status === "DECLINED" ? "Declined" : "Accepted"} on {q.decidedAt.toLocaleDateString()} ({q.decidedVia === "PORTAL" ? "by the client in the portal" : "recorded by staff"}){q.decisionNote ? `: ${q.decisionNote}` : ""}</p>}
        {q.invoiceId && <p className="text-sm">Invoice: <Link className="underline" href={`/finance/invoices/${q.invoiceId}`}>open the draft invoice</Link></p>}
      </section>
      {canManage && (
        <div className="flex flex-wrap gap-2 items-start">
          {q.status === "DRAFT" && form("send", "Mark as sent to client")}
          {(q.status === "DRAFT" || q.status === "SENT") && form("cancel", "Cancel quotation", true)}
          {q.status === "ACCEPTED" && canInvoice && form("convert", "Convert to draft invoice")}
          {q.status === "ACCEPTED" && !canInvoice && <p className="text-sm text-muted">Ask someone who can create invoices to convert this quotation.</p>}
          {q.status === "SENT" && (
            <form action={act} className="card flex flex-wrap items-end gap-2 w-full">
              {hid}
              <div className="grow"><label className="label" htmlFor="note">Decision received by email or phone (note)</label><input id="note" name="note" maxLength={500} className="input" /></div>
              <div><label className="label" htmlFor="op">Outcome</label><select id="op" name="op" className="input"><option value="accept">Accepted</option><option value="decline">Declined</option></select></div>
              <button className="btn">Record decision</button>
            </form>
          )}
        </div>
      )}
      {q.status === "SENT" && <p className="text-xs text-muted">The client can also accept or decline from the client portal.</p>}
    </div>
  );
}
