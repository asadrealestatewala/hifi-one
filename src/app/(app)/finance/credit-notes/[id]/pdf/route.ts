import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { creditNotePdf } from "@/lib/pdf";
import { loadCreditNoteDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("finance.view");
  const { id } = await params;
  const doc = await loadCreditNoteDoc(db, { organizationId: user.organizationId, creditNoteId: id });
  if (!doc) return notFound();
  await audit(user, { action: "document.credit_note_pdf", entity: "CreditNote", entityId: id });
  return pdfResponse(await creditNotePdf(doc), `credit-note-${doc.number}`);
}
