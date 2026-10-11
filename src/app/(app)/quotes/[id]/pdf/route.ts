import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotePdf } from "@/lib/pdf";
import { loadQuoteDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("quotes.view");
  const { id } = await params;
  const doc = await loadQuoteDoc(db, { organizationId: user.organizationId, quoteId: id });
  if (!doc) return notFound();
  await audit(user, { action: "document.quote_pdf", entity: "Quote", entityId: id });
  return pdfResponse(await quotePdf(doc), `quotation-${doc.number}`);
}
