import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { statementPdf } from "@/lib/pdf";
import { loadStatementDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("clients.view");
  // A statement shows money, so it also needs finance access (the same rule as the statement on screen)
  if (!user.permissions.has("finance.view")) return notFound();
  const { id } = await params;
  const doc = await loadStatementDoc(db, { organizationId: user.organizationId, clientId: id });
  if (!doc) return notFound();
  await audit(user, { action: "document.statement_pdf", entity: "Client", entityId: id });
  return pdfResponse(await statementPdf(doc), `statement-${doc.client.code ?? id}`);
}
