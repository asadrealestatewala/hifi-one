import { audit, requireVendorUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvDownload, statementCsv } from "@/lib/ledger-csv";
import { loadVendorStatementDoc } from "@/lib/pdf-data";
import { notFound } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireVendorUser();
  const doc = await loadVendorStatementDoc(db, { organizationId: user.organizationId, vendorId: user.vendorId });
  if (!doc) return notFound();
  await audit(user, { action: "document.vendor_statement_csv", entity: "Vendor", entityId: user.vendorId });
  return csvDownload(statementCsv(doc, "vendor"), "vendor-statement");
}
