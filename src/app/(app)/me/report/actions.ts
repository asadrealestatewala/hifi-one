"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ReportError, submitDailyReport } from "@/lib/daily-reports";
import { dateInZone } from "@/lib/hr-rules";
import { notify } from "@/lib/notifications";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (date: string, k: "error" | "msg", m: string): never => redirect(`/me/report?date=${encodeURIComponent(date)}&${k}=${encodeURIComponent(m)}`);

// The employee writes or updates their own report for one day. The manager is told the first time it arrives.
export async function submitDailyReportAction(formData: FormData): Promise<void> {
  const user = await requirePermission("self.attendance");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(new Date(), profile?.timezone ?? "UTC");
  const workDate = str(formData, "workDate") || today;
  try {
    const { report, created } = await submitDailyReport(db, {
      organizationId: user.organizationId, userId: user.id, workDate, today,
      summary: str(formData, "summary"), blockers: str(formData, "blockers"), plan: str(formData, "plan"), hoursWorked: str(formData, "hoursWorked") || null,
    });
    await audit(user, { action: created ? "report.submit" : "report.update", entity: "DailyReport", entityId: report.id, after: { workDate: report.workDate, late: report.late } });
    if (created) {
      const me = await db.user.findUnique({ where: { id: user.id }, select: { managerId: true } });
      if (me?.managerId) await notify(db, me.managerId, { kind: "report.submitted", title: `${user.name} sent the daily report for ${report.workDate}`, body: report.summary.slice(0, 140), link: `/hr/reports?date=${report.workDate}`, dedupeKey: `report:${report.id}` });
    }
  } catch (e) {
    if (e instanceof ReportError) back(workDate, "error", e.message);
    throw e;
  }
  revalidatePath("/me/report");
  back(workDate, "msg", "Report saved. Your manager and HR can see it now.");
}
