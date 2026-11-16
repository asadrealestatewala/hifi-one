import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { Badge, Empty, Notice, PageHeader, Pager, StatusBadge } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import { reportPaymentAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { page?: string; saved?: string; error?: string };
type Snap = Record<string, string | null>;
const money = (v: { toString(): string }, cur: string) => `${Number(v.toString()).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" }) : "");
const NOTICE_LABEL: Record<string, string> = { PENDING: "Payment reported, Hifi is checking", CONFIRMED: "Payment confirmed", REJECTED: "Payment not found yet" };

// Hifi's invoices to a reseller who bills their own schools. Read only for the partner's own billing record; drafts never show.
export default async function MyInvoices({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, earner } = await requirePartnerUser();
  const sp = await searchParams;
  if (!earner.billingClientId) {
    return (
      <div className="space-y-5">
        <PageHeader title="Invoices" />
        <Empty title="No invoices">Invoices from Hifi appear here when you resell a Solution and bill your schools yourself.</Empty>
      </div>
    );
  }
  const where = { organizationId: user.organizationId, clientId: earner.billingClientId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "CREDITED"] } };
  const pg = paging(sp.page, 20);
  const [rows, total] = await Promise.all([
    db.invoice.findMany({ where, orderBy: [{ issueDate: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.invoice.count({ where }),
  ]);
  const notices = await db.partnerPaymentNotice.findMany({ where: { earnerId: earner.id, invoiceId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" } });
  const now = new Date();
  const today = new Date(now.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" subtitle="Hifi's monthly invoices for the schools you bill yourself. Pay into Hifi Marketing and Technologies' account printed on each invoice, then tell us with the receipt." />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {rows.length === 0 ? <Empty title="No invoices yet">Your first invoice comes after the first month you enter student counts.</Empty> : (
        <ul className="space-y-3">
          {rows.map((inv) => {
            const owed = inv.total.sub(inv.amountPaid).sub(inv.creditedAmount);
            const open = ["ISSUED", "PARTIALLY_PAID"].includes(inv.status) && owed.gt(0);
            const late = open && inv.dueDate ? Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000) : 0;
            const mine = notices.filter((n) => n.invoiceId === inv.id);
            const pending = mine.find((n) => n.status === "PENDING");
            const bank = inv.bankSnapshot as Snap | null;
            return (
              <li key={inv.id} id={`inv-${inv.id}`} className="card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{inv.number} · {money(inv.total, inv.currency)}</p>
                    <p className="text-sm text-muted">Issued {day(inv.issueDate)}{inv.dueDate && ` · due ${day(inv.dueDate)}`}{inv.amountPaid.gt(0) && ` · paid ${money(inv.amountPaid, inv.currency)}`}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {late > 0 ? <Badge tone="danger">{late} day{late === 1 ? "" : "s"} late</Badge> : <StatusBadge status={inv.status} />}
                    <a className="btn-ghost text-sm" href={`/partner/invoices/${inv.id}/pdf`} target="_blank" rel="noopener">Download PDF</a>
                  </div>
                </div>
                {inv.notes && <p className="text-sm">{inv.notes}</p>}
                {mine.map((n) => (
                  <p key={n.id} className="text-sm"><Badge tone={n.status === "CONFIRMED" ? "success" : n.status === "REJECTED" ? "danger" : "warning"}>{NOTICE_LABEL[n.status]}</Badge> {money(n.amount, n.currency)} paid {day(n.paidOn)}, ref {n.reference}{n.reviewNote && `: ${n.reviewNote}`}</p>
                ))}
                {open && (
                  <>
                    {bank ? (
                      <div className="rounded-lg bg-surface-2 p-3 text-sm">
                        <p className="font-medium">Pay {money(owed, inv.currency)} to</p>
                        <p>{bank.accountHolder} · {bank.bankName}</p>
                        <p className="font-mono text-xs">Account {bank.accountNumber}{bank.iban && ` · IBAN ${bank.iban}`}{bank.swift && ` · SWIFT ${bank.swift}`}</p>
                        {bank.paymentInstructions && <p className="text-muted">{bank.paymentInstructions}</p>}
                        {!bank.paymentInstructions && <p className="text-xs text-muted">Write {inv.number} in the transfer description.</p>}
                      </div>
                    ) : <p className="text-sm text-muted">The bank details are on the PDF.</p>}
                    {!pending && (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium">I&rsquo;ve paid</summary>
                        <form action={reportPaymentAction} className="mt-3 space-y-3">
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div><label className="label" htmlFor={`pa-${inv.id}`}>Amount ({inv.currency})</label><input id={`pa-${inv.id}`} name="amount" inputMode="decimal" required defaultValue={owed.toFixed(2)} className="input" /></div>
                            <div><label className="label" htmlFor={`pd-${inv.id}`}>Date paid</label><input id={`pd-${inv.id}`} name="paidOn" type="date" required max={today} defaultValue={today} className="input" /></div>
                            <div><label className="label" htmlFor={`pr-${inv.id}`}>Transaction ID or reference</label><input id={`pr-${inv.id}`} name="reference" required minLength={3} maxLength={80} className="input" /></div>
                          </div>
                          <div><label className="label" htmlFor={`pf-${inv.id}`}>Receipt or screenshot (JPG, PNG or PDF, up to 5 MB)</label><input id={`pf-${inv.id}`} name="receipt" type="file" required accept=".jpg,.jpeg,.png,.pdf" className="input" /></div>
                          <SubmitButton pendingText="Sending…">Send to Hifi</SubmitButton>
                        </form>
                      </details>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={pg.page} size={pg.size} total={total} href={(n) => `/partner/invoices?page=${n}`} />
      {total > 0 && <p className="text-xs text-muted">An unpaid invoice gets a reminder 7 days after it is due. Schools may be paused if it stays unpaid.</p>}
    </div>
  );
}
