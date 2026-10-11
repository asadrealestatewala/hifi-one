import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { statementPdf } from "@/lib/pdf";
import { loadStatementDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireClientUser();
  const doc = await loadStatementDoc(db, { organizationId: user.organizationId, clientId: user.clientId });
  if (!doc) return notFound();
  await audit(user, { action: "document.statement_pdf", entity: "Client", entityId: user.clientId });
  return pdfResponse(await statementPdf(doc), "account-statement");
}
