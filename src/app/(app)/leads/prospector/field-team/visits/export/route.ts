import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fieldVisitsCsv } from "@/lib/field-reports";
import { zoneOffsetMinutes } from "@/lib/field-visits";
import { csvDownload } from "@/lib/ledger-csv";
import { companyZone } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

// Every field visit matching the filters on screen, one row each, as CSV. Same permission as the report.
export async function GET(req: Request) {
  const user = await requirePermission("field.review");
  const sp = new URL(req.url).searchParams;
  const tz = zoneOffsetMinutes(await companyZone(user.organizationId));
  const csv = await fieldVisitsCsv(db, user, { productId: sp.get("product") || undefined, agentId: sp.get("agent") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined, tzOffsetMinutes: tz });
  return csvDownload(csv.text, csv.filename);
}
