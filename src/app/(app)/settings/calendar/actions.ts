"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CalendarError, addHoliday, getCalendar, readCalendarInput, removeHoliday, saveCalendar, seedPakistanHolidays } from "@/lib/working-calendar";

const flash = (kind: "error" | "ok", m: string): never => redirect(`/settings/calendar?${kind}=${encodeURIComponent(m)}`);
const message = (e: unknown) => (e instanceof CalendarError ? e.message : null);

// Office hours, lunch, the grace period and which weekdays are working days. Everything that counts a day reads these.
export async function saveWorkingCalendar(formData: FormData): Promise<void> {
  const user = await requirePermission("settings.company.edit");
  const before = await getCalendar(db, user.organizationId);
  try {
    const input = readCalendarInput((k) => String(formData.getAll(k).join(",") ?? ""));
    await saveCalendar(db, user.organizationId, input, user.id);
    await db.settingChange.create({ data: { organizationId: user.organizationId, section: "working_calendar", actorId: user.id, before, after: input } });
    await audit(user, { action: "settings.calendar.save", entity: "WorkingCalendar", entityId: user.organizationId, before, after: input });
  } catch (e) {
    const m = message(e);
    if (m) return flash("error", m);
    throw e;
  }
  revalidatePath("/settings/calendar");
  return flash("ok", "Saved. Attendance, leave, daily reports, scorecards and the reminders all follow these hours from now on.");
}

export async function addPublicHoliday(formData: FormData): Promise<void> {
  const user = await requirePermission("settings.company.edit");
  const date = String(formData.get("date") ?? "").trim();
  try {
    const row = await addHoliday(db, user.organizationId, date, String(formData.get("name") ?? ""));
    await audit(user, { action: "settings.calendar.holiday_add", entity: "PublicHoliday", entityId: row.id, after: { date: row.date, name: row.name } });
  } catch (e) {
    const m = message(e);
    if (m) return flash("error", m);
    throw e;
  }
  revalidatePath("/settings/calendar");
  return flash("ok", `${date} is now a holiday. Nobody is expected to work or report on it.`);
}

export async function removePublicHoliday(formData: FormData): Promise<void> {
  const user = await requirePermission("settings.company.edit");
  try {
    const row = await removeHoliday(db, user.organizationId, String(formData.get("id") ?? ""));
    await audit(user, { action: "settings.calendar.holiday_remove", entity: "PublicHoliday", entityId: row.id, before: { date: row.date, name: row.name } });
    revalidatePath("/settings/calendar");
    return flash("ok", `${row.date} is a working day again.`);
  } catch (e) {
    const m = message(e);
    if (m) return flash("error", m);
    throw e;
  }
}

// Adds the built-in Pakistan public holidays for a year, keeping any date already on the list.
export async function addPakistanHolidays(formData: FormData): Promise<void> {
  const user = await requirePermission("settings.company.edit");
  const year = String(formData.get("year") ?? "").trim();
  try {
    const r = await seedPakistanHolidays(db, user.organizationId, year);
    await audit(user, { action: "settings.calendar.holidays_seed", entity: "PublicHoliday", entityId: user.organizationId, after: { year, added: r.added.length, kept: r.kept } });
    revalidatePath("/settings/calendar");
    return flash("ok", r.added.length === 0 ? `Every ${year} holiday was already on the list.` : `Added ${r.added.length} holiday${r.added.length === 1 ? "" : "s"} for ${year}. Check the dates that move with the moon against the official notification.`);
  } catch (e) {
    const m = message(e);
    if (m) return flash("error", m);
    throw e;
  }
}
