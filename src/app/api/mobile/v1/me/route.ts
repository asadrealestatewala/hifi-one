import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { companyZone, isResponse, json, publicUser, requireMobileUser } from "@/lib/mobile-api";
import { unreadCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// The signed-in person plus the numbers the home screen shows. Everything is scoped to the caller.
export async function GET(req: Request) {
  const a = await requireMobileUser(req);
  if (isResponse(a)) return a;
  const { user } = a;
  const zone = await companyZone(user.organizationId);
  const today = dateInZone(new Date(), zone);
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const mine = { assigneeId: user.id, project: { organizationId: user.organizationId, status: { not: "CANCELLED" as const } }, parentId: null };
  const [open, overdue, dueToday, unread, attendance, pendingLeave] = await Promise.all([
    db.task.count({ where: { ...mine, status: { not: "DONE" } } }),
    db.task.count({ where: { ...mine, status: { not: "DONE" }, dueDate: { lt: dayStart } } }),
    db.task.count({ where: { ...mine, status: { not: "DONE" }, dueDate: { gte: dayStart, lt: dayEnd } } }),
    unreadCount(db, user.id),
    user.permissions.has("self.attendance") ? db.attendanceRecord.findFirst({ where: { userId: user.id, clockOut: null }, include: { breaks: true } }) : null,
    user.permissions.has("self.leave") ? db.leaveRequest.count({ where: { userId: user.id, status: "PENDING" } }) : 0,
  ]);
  return json({
    user: publicUser(user), timezone: zone, today,
    tasks: { open, overdue, dueToday },
    notifications: { unread },
    pendingLeave,
    clockedIn: attendance ? { since: attendance.clockIn.toISOString(), mode: attendance.workMode, onBreak: attendance.breaks.some((b) => !b.endAt) } : null,
  });
}
