"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ReportError, reviewDailyReport } from "@/lib/daily-reports";
import { notify } from "@/lib/notifications";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const safeReturn = (p: string) => (p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/hr/reports");

// A manager (own reports) or HR (everyone) acknowledges a daily report with an optional note and rating.
export async function reviewDailyReportAction(formData: FormData): Promise<void> {
  const user = await requirePermission("leave.approve");
  const to = safeReturn(str(formData, "returnTo") || "/hr/reports");
  const back = (k: "error" | "msg", m: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`);
  try {
    const r = await reviewDailyReport(db, {
      organizationId: user.organizationId, reportId: str(formData, "reportId"), reviewerId: user.id, canReviewAll: user.permissions.has("attendance.view_all"),
      note: str(formData, "note"), rating: str(formData, "rating") || null,
    });
    await audit(user, { action: "report.review", entity: "DailyReport", entityId: r.id, after: { rating: r.rating, workDate: r.workDate } });
    await notify(db, r.userId, { kind: "report.reviewed", title: `Your report for ${r.workDate} was reviewed${r.rating ? ` · ${r.rating}/5` : ""}`, body: r.reviewNote ?? undefined, link: `/me/report?date=${r.workDate}`, dedupeKey: `report-review:${r.id}:${r.reviewedAt?.getTime()}` });
  } catch (e) {
    if (e instanceof ReportError) back("error", e.message);
    throw e;
  }
  revalidatePath(to);
  back("msg", "Report reviewed.");
}
