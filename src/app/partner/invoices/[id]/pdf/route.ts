import { audit, requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoicePdf } from "@/lib/pdf";
import { loadInvoiceDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// A reseller's invoice from Hifi. The client is the partner's own billing record from the session; anything else, or a draft, is a 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, earner } = await requirePartnerUser();
  const { id } = await params;
  if (!earner.billingClientId) return notFound();
  const doc = await loadInvoiceDoc(db, { organizationId: user.organizationId, invoiceId: id, clientId: earner.billingClientId });
  if (!doc) return notFound();
  await audit(user, { action: "document.invoice_pdf", entity: "Invoice", entityId: id });
  return pdfResponse(await invoicePdf(doc), `invoice-${doc.number}`);
}
