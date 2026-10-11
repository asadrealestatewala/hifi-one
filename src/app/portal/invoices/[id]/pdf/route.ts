import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoicePdf } from "@/lib/pdf";
import { loadInvoiceDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// The client id comes from the signed-in user's own record. Another client's invoice, or a draft, is a plain 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireClientUser();
  const { id } = await params;
  const doc = await loadInvoiceDoc(db, { organizationId: user.organizationId, invoiceId: id, clientId: user.clientId });
  if (!doc) return notFound();
  await audit(user, { action: "document.invoice_pdf", entity: "Invoice", entityId: id });
  return pdfResponse(await invoicePdf(doc), `invoice-${doc.number}`);
}
