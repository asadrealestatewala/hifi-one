import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { agreementPdf } from "@/lib/pdf";
import { loadAgreementDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("contracts.view");
  const { id } = await params;
  const doc = await loadAgreementDoc(db, { organizationId: user.organizationId, agreementId: id });
  if (!doc) return notFound();
  await audit(user, { action: "document.agreement_pdf", entity: "Agreement", entityId: id });
  return pdfResponse(await agreementPdf(doc), `agreement-${doc.number}`);
}
