"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone, isDateString } from "@/lib/hr-rules";
import { generateEndOfDay } from "@/lib/scorecards";

// HR regenerates one day's end-of-day record on demand (the job does it at office close). Replaces the day's rows with current facts.
export async function generateEndOfDayAction(formData: FormData): Promise<void> {
  const user = await requirePermission("attendance.view_all");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const tz = profile?.timezone ?? "UTC";
  const today = dateInZone(new Date(), tz);
  const date = String(formData.get("date") ?? "").trim();
  if (!isDateString(date) || date > today) redirect(`/hr/reports/eod?date=${today}&error=${encodeURIComponent("Pick a day up to today.")}`);
  const r = await generateEndOfDay(db, { organizationId: user.organizationId, workDate: date, timeZone: tz });
  await audit(user, { action: "report.eod_generate", entity: "DayScorecard", after: { workDate: date, rows: r.rows.length } });
  revalidatePath("/hr/reports/eod");
  redirect(`/hr/reports/eod?date=${date}&msg=${encodeURIComponent(`Generated for ${r.rows.length} ${r.rows.length === 1 ? "person" : "people"}.`)}`);
}
