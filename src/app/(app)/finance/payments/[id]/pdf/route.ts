import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { receiptPdf } from "@/lib/pdf";
import { loadReceiptDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// A receipt is generated from a recorded payment, never from an invoice status
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("finance.view");
  const { id } = await params;
  const doc = await loadReceiptDoc(db, { organizationId: user.organizationId, paymentId: id });
  if (!doc) return notFound();
  await audit(user, { action: "document.receipt_pdf", entity: "Payment", entityId: id });
  return pdfResponse(await receiptPdf(doc), `receipt-${doc.number}`);
}
