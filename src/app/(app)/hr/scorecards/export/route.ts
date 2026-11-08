import { requirePermission } from "@/lib/auth";
import { tableCsv } from "@/lib/crm-contacts";
import { db } from "@/lib/db";
import { csvDownload } from "@/lib/ledger-csv";
import { monthlyScorecards } from "@/lib/scorecards";

export const dynamic = "force-dynamic";

// The month's scorecards as CSV, one row per employee. Same permission as the page.
export async function GET(req: Request) {
  const user = await requirePermission("attendance.view_all");
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Bad month", { status: 400 });
  const rows = await monthlyScorecards(db, { organizationId: user.organizationId, month });
  const text = tableCsv(
    ["Month", "Employee", "Expected days", "Present days", "Average minutes", "Late days", "Reports sent", "Reports late", "Average rating", "Tasks done", "Hours logged", "Sales kind", "Activity", "Target", "Demos", "Average score"],
    rows.map((r) => [month, r.name, r.days, r.present, r.avgMinutes, r.lateDays, r.reportsSent, r.reportsLate, r.avgRating ?? "", r.tasksDone, r.hoursLogged, r.salesKind ?? "", r.activity, r.target, r.demosRequested, r.avgScore]),
  );
  return csvDownload(text, `scorecards-${month}.csv`);
}
