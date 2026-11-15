import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import FilesPanel from "@/components/FilesPanel";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// One payment received: what came in, where it went, which invoices it settled, and its proof of payment (finance staff only).
export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ recorded?: string; fileError?: string; fileOk?: string }> }) {
  const user = await requirePermission("finance.view");
  const { id } = await params;
  const sp = await searchParams;
  const p = await db.payment.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { client: true, allocations: { include: { invoice: true } } },
  });
  if (!p) notFound();
  const [bank, receivedBy] = await Promise.all([
    db.bankAccount.findFirst({ where: { id: p.bankAccountId, organizationId: user.organizationId }, select: { internalName: true } }),
    p.receivedById ? db.user.findFirst({ where: { id: p.receivedById, organizationId: user.organizationId }, select: { name: true } }) : null,
  ]);
  const rows: [string, string][] = [
    ["Client", p.client.name],
    ["Date received", p.date.toISOString().slice(0, 10)],
    ["Amount", formatMoney(p.amount, p.currency)],
    ["Received into", bank?.internalName ?? "-"],
    ["Method", p.method.replace(/_/g, " ").toLowerCase()],
    ["Transaction reference", p.reference ?? "-"],
    ["Recorded by", receivedBy?.name ?? "-"],
  ];
  if (p.unallocated.gt(0)) rows.push(["Not yet applied (advance)", formatMoney(p.unallocated, p.currency)]);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader back={{ href: "/finance/payments", label: "Payments" }} title={`Payment ${p.number}`}
        actions={<a className="btn-ghost" href={`/finance/payments/${p.id}/pdf`} target="_blank" rel="noopener">Receipt PDF</a>} />
      {sp.recorded && <Notice kind="ok">Payment recorded and applied to open invoices, oldest first.</Notice>}
      <section className="card">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
      </section>
      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">Invoices settled</h2>
        {p.allocations.length === 0 ? <p className="text-muted">Not applied to any invoice yet. It is held as an advance for this client.</p> : (
          <ul className="space-y-1">
            {p.allocations.map((a) => <li key={a.id}><Link className="text-primary hover:underline" href={`/finance/invoices/${a.invoiceId}`}>{a.invoice.number ?? "Draft"}</Link>: {formatMoney(a.amount, p.currency)}</li>)}
          </ul>
        )}
      </section>
      <div id="files">
        <FilesPanel user={user} ownerType="PAYMENT" ownerId={p.id} returnTo={`/finance/payments/${p.id}`} title="Proof of payment" flash={{ fileError: sp.fileError, fileOk: sp.fileOk }} />
      </div>
    </div>
  );
}
