import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoicePdf } from "@/lib/pdf";
import { loadInvoiceDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("finance.view");
  const { id } = await params;
  const doc = await loadInvoiceDoc(db, { organizationId: user.organizationId, invoiceId: id });
  if (!doc) return notFound();
  await audit(user, { action: "document.invoice_pdf", entity: "Invoice", entityId: id });
  return pdfResponse(await invoicePdf(doc), `invoice-${doc.number ?? "draft"}`);
}
