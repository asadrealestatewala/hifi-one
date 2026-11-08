import { requirePermission } from "@/lib/auth";
import { tableCsv } from "@/lib/crm-contacts";
import { db } from "@/lib/db";
import { isDateString } from "@/lib/hr-rules";
import { csvDownload } from "@/lib/ledger-csv";
import { dayRowsFor } from "@/lib/scorecards";

export const dynamic = "force-dynamic";

// One day's end-of-day report as CSV, one row per employee. Same permission as the page.
export async function GET(req: Request) {
  const user = await requirePermission("attendance.view_all");
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!isDateString(date)) return new Response("Bad date", { status: 400 });
  const rows = await dayRowsFor(db, user.organizationId, date);
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const text = tableCsv(
    ["Date", "Employee", "Expected", "Clock in", "Clock out", "Late minutes", "Worked minutes", "Tasks done", "Tasks overdue", "Hours logged", "Sales kind", "Activity", "Target", "Prospects added", "Calls", "Visits", "Demos", "Daily report", "Rating", "Score"],
    rows.map((r) => [r.workDate, names.get(r.userId) ?? r.userId, r.expected ? "yes" : "on leave", r.clockIn ?? "", r.clockOut ?? "", r.lateMinutes, r.attendanceMinutes, r.tasksDone, r.tasksOverdue, Number(r.hoursLogged), r.salesKind ?? "", r.activity, r.target ?? "", r.prospectsAdded, r.outreach, r.visits, r.demosRequested, r.reportStatus, r.rating ?? "", r.score]),
  );
  return csvDownload(text, `end-of-day-${date}.csv`);
}
