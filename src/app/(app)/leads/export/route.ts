import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvResponse, listExport } from "@/lib/lists";

export const dynamic = "force-dynamic";

// Every lead the person can see matching the filters on screen, as CSV, with no page cap. Same permission as the list.
export async function GET(req: Request) {
  const user = await requirePermission("crm.view");
  return csvResponse(listExport(db, "leads", user, new URL(req.url).searchParams));
}
