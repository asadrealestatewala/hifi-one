import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotePdf } from "@/lib/pdf";
import { loadQuoteDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireClientUser();
  const { id } = await params;
  const doc = await loadQuoteDoc(db, { organizationId: user.organizationId, quoteId: id, clientId: user.clientId });
  if (!doc) return notFound();
  await audit(user, { action: "document.quote_pdf", entity: "Quote", entityId: id });
  return pdfResponse(await quotePdf(doc), `quotation-${doc.number}`);
}
