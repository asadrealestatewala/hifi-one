import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvResponse, listExport } from "@/lib/lists";

export const dynamic = "force-dynamic";

// Every audit entry (no before/after values or IP addresses) matching the filters on screen, as CSV, with no page cap. Same permission as the list.
export async function GET(req: Request) {
  const user = await requirePermission("audit.view");
  return csvResponse(listExport(db, "audit", user, new URL(req.url).searchParams));
}
