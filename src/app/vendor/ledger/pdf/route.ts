import { audit, requireVendorUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { statementPdf } from "@/lib/pdf";
import { loadVendorStatementDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireVendorUser();
  const doc = await loadVendorStatementDoc(db, { organizationId: user.organizationId, vendorId: user.vendorId });
  if (!doc) return notFound();
  await audit(user, { action: "document.vendor_statement_pdf", entity: "Vendor", entityId: user.vendorId });
  return pdfResponse(await statementPdf(doc), "vendor-statement");
}
