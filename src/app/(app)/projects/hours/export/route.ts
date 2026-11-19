import { requirePermission } from "@/lib/auth";
import { tableCsv } from "@/lib/crm-contacts";
import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { loadHoursReport, periodRange } from "@/lib/hours-report";
import { csvDownload } from "@/lib/ledger-csv";
import { projectScope } from "@/lib/projects";
import { getWorkingContext } from "@/lib/working-calendar";

export const dynamic = "force-dynamic";

// The hours report as CSV, one row per person. Same rule as the screen: projects.manage, or the manager of at least one project
// (who then sees time on the projects they manage only).
export async function GET(req: Request) {
  const user = await requirePermission("projects.view");
  const canManage = user.permissions.has("projects.manage");
  if (!canManage && (await db.project.count({ where: { organizationId: user.organizationId, managerId: user.id } })) === 0) return new Response("Forbidden", { status: 403 });
  const q = new URL(req.url).searchParams;
  const period = q.get("period") === "week" ? "week" : "month";
  const at = q.get("at") ?? undefined;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(new Date(), profile?.timezone ?? "UTC");
  const range = periodRange(period, at, today);
  const work = await getWorkingContext(db, user.organizationId, range.from, range.to);
  const scope = canManage ? projectScope(user) : { organizationId: user.organizationId, managerId: user.id };
  const r = await loadHoursReport(db, { scope, organizationId: user.organizationId, period, at, today, calendar: work.calendar, holidays: work.holidayDates });
  const text = tableCsv(
    ["From", "To", "Person", "Working hours", "Working hours so far", "Planned hours", "Tasks without estimate", "Logged hours", "Client hours", "Internal hours", "Awaiting approval", "Utilisation %"],
    r.rows.map((x) => [r.from, r.to, x.name, x.availableHours, x.availableSoFar, x.plannedHours, x.unestimated, x.loggedHours, x.clientHours, x.internalHours, x.pendingHours, x.utilisation ?? ""]),
  );
  return csvDownload(text, `team-hours-${r.from}-to-${r.to}.csv`);
}
