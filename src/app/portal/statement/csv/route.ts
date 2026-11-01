import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvDownload, statementCsv } from "@/lib/ledger-csv";
import { loadStatementDoc } from "@/lib/pdf-data";
import { notFound } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireClientUser();
  const doc = await loadStatementDoc(db, { organizationId: user.organizationId, clientId: user.clientId });
  if (!doc) return notFound();
  await audit(user, { action: "document.statement_csv", entity: "Client", entityId: user.clientId });
  return csvDownload(statementCsv(doc, "client"), "account-statement");
}
