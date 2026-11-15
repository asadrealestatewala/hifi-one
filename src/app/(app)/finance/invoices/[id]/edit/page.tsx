import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import InvoiceEditor from "../../InvoiceEditor";
import { saveInvoiceAction } from "../../actions";
import { loadEditorData } from "../../editor-data";

export const dynamic = "force-dynamic";

// Editing is for drafts only; an issued invoice is corrected with a credit note.
export default async function EditInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("finance.post");
  const { id } = await params;
  const sp = await searchParams;
  const inv = await db.invoice.findFirst({ where: { id, organizationId: user.organizationId }, include: { lines: true } });
  if (!inv) notFound();
  if (inv.status !== "DRAFT") redirect(`/finance/invoices/${id}?error=${encodeURIComponent("Only draft invoices can be edited. Use a credit note to correct an issued invoice.")}`);
  const data = await loadEditorData(user.organizationId);
  // Keep the client on the list even if it was deactivated after the draft was made
  if (!data.clients.some((c) => c.id === inv.clientId)) {
    const c = await db.client.findFirst({ where: { id: inv.clientId, organizationId: user.organizationId }, select: { id: true, name: true, currency: true, billingAddress: true, taxId: true, paymentTermsDays: true } });
    if (c) data.clients.unshift(c);
  }
  const initial = {
    id: inv.id, number: inv.number, clientId: inv.clientId, currency: inv.currency, taxRate: inv.taxRate.toString(), notes: inv.notes ?? "", templateKey: inv.templateKey,
    lines: inv.lines.map((l) => ({ desc: l.description, qty: l.quantity.toString(), price: l.unitPrice.toString() })),
  };
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: `/finance/invoices/${id}`, label: "Invoice" }} title="Edit draft invoice" subtitle="Changes show in the preview as you type. Nothing is posted until you issue it." />
      <InvoiceEditor data={data} action={saveInvoiceAction} initial={initial} error={sp.error} cancelHref={`/finance/invoices/${id}`} />
    </div>
  );
}
