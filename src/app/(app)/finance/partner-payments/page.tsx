import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { signDownload } from "@/lib/files";
import { partnerId } from "@/lib/partner-stack";
import { paging } from "@/lib/paging";
import { Badge, Chips, Empty, Notice, PageHeader, Pager } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { confirmNoticeAction, rejectNoticeAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { status?: string; page?: string; saved?: string; error?: string };
const money = (v: { toString(): string }, cur: string) => `${Number(v.toString()).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });
const STATES = [["PENDING", "To check"], ["CONFIRMED", "Confirmed"], ["REJECTED", "Sent back"]] as const;

// Resellers tell Hifi they paid an invoice, with the receipt. Finance checks the bank statement, then confirms (a normal
// receipt against the invoice) or sends it back with a reason. Nothing is marked paid until Finance confirms.
export default async function PartnerPayments({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("finance.post");
  const sp = await searchParams;
  const org = user.organizationId;
  const status = STATES.some(([k]) => k === sp.status) ? sp.status! : "PENDING";
  const where = { organizationId: org, status };
  const pg = paging(sp.page);
  const [rows, total, byStatus, banks] = await Promise.all([
    db.partnerPaymentNotice.findMany({ where, include: { earner: { select: { id: true, name: true, partnerNumber: true } } }, orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" }, skip: pg.skip, take: pg.take }),
    db.partnerPaymentNotice.count({ where }),
    db.partnerPaymentNotice.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    db.bankAccount.findMany({ where: { organizationId: org, active: true }, orderBy: [{ isDefault: "desc" }, { internalName: "asc" }], select: { id: true, internalName: true, currency: true, isDefault: true } }),
  ]);
  const [invoices, files] = await Promise.all([
    db.invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId) }, organizationId: org }, select: { id: true, number: true, total: true, amountPaid: true, creditedAmount: true, currency: true, status: true } }),
    db.storedFile.findMany({ where: { ownerType: "PARTNER_PAYMENT_NOTICE", ownerId: { in: rows.map((r) => r.id) } }, select: { id: true, ownerId: true, filename: true } }),
  ]);
  const secret = process.env.SESSION_SECRET ?? "";
  const count = new Map(byStatus.map((s) => [s.status, s._count]));
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="client-billing" current="/finance/partner-payments" />} title="Partner payments" subtitle="Payments resellers report against Hifi's invoices. Check the bank statement, then confirm into the account the money arrived in." />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <Chips current={status} items={STATES.map(([k, l]) => ({ key: k, label: l, count: count.get(k) ?? 0, href: `/finance/partner-payments?status=${k}` }))} />
      {rows.length === 0 ? <Empty title={status === "PENDING" ? "Nothing to check" : "None yet"}>{status === "PENDING" ? "When a reseller reports a payment with a receipt, it appears here." : <Link className="underline" href="/finance/partner-payments">Back to payments to check</Link>}</Empty> : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Partner</th><th className="pr-4">Invoice</th><th className="pr-4">Reported</th><th className="pr-4">Receipt</th><th className="pr-4">{status === "PENDING" ? "Action" : "Result"}</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((n) => {
                const inv = invoices.find((i) => i.id === n.invoiceId);
                const f = files.find((x) => x.ownerId === n.id);
                const fit = banks.filter((b) => b.currency === n.currency);
                return (
                  <tr key={n.id} className="align-top">
                    <td className="px-4 py-2.5">{n.earner.name}<br /><span className="font-mono text-xs text-muted">{partnerId(n.earner.partnerNumber)}</span></td>
                    <td className="pr-4 py-2.5">{inv ? <><Link className="underline" href={`/finance/invoices/${inv.id}`}>{inv.number}</Link><br /><span className="text-xs text-muted">{money(inv.total.sub(inv.amountPaid).sub(inv.creditedAmount), inv.currency)} open</span></> : "—"}</td>
                    <td className="pr-4 py-2.5 whitespace-nowrap"><strong>{money(n.amount, n.currency)}</strong><br /><span className="text-xs text-muted">paid {day(n.paidOn)} · ref {n.reference}</span></td>
                    <td className="pr-4 py-2.5">{f ? <a className="underline" href={`/api/files/${f.id}?t=${signDownload(f.id, user.id, secret)}`} target="_blank" rel="noopener">{f.filename}</a> : <span className="text-muted">None</span>}</td>
                    <td className="pr-4 py-2.5">
                      {n.status === "PENDING" ? (
                        <div className="flex flex-wrap items-end gap-2">
                          {fit.length === 0 ? <span className="text-xs text-brand">No active {n.currency} bank account. Add one in Finance → Bank accounts.</span> : (
                            <form action={confirmNoticeAction} className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="noticeId" value={n.id} />
                              <div><label className="label" htmlFor={`bk-${n.id}`}>Arrived in</label><select id={`bk-${n.id}`} name="bankAccountId" className="input">{fit.map((b) => <option key={b.id} value={b.id}>{b.internalName}{b.isDefault ? " (default)" : ""}</option>)}</select></div>
                              <ConfirmButton className="btn" title="Confirm this payment?" message={<>Records receipt of {money(n.amount, n.currency)} against {inv?.number} and posts it to the books. Only confirm after you see the money in the bank statement.</>} confirmLabel="Confirm payment">Confirm</ConfirmButton>
                            </form>
                          )}
                          <form action={rejectNoticeAction}><input type="hidden" name="noticeId" value={n.id} /><ConfirmButton reason title="Send back to the partner?" message="Say what is wrong, for example not in the statement yet or a different amount. The partner sees it by email and in their portal." confirmLabel="Send back">Send back</ConfirmButton></form>
                        </div>
                      ) : <><Badge tone={n.status === "CONFIRMED" ? "success" : "danger"}>{n.status === "CONFIRMED" ? "Confirmed" : "Sent back"}</Badge>{n.reviewNote && <span className="block text-xs text-muted">{n.reviewNote}</span>}{n.reviewedAt && <span className="block text-xs text-muted">{day(n.reviewedAt)}</span>}</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={total} href={(p) => `/finance/partner-payments?status=${status}&page=${p}`} />
        </div>
      )}
    </div>
  );
}
