import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { HrError } from "@/lib/hr";
import { breakEndAll, breakStartAll, clockInAll, clockOutAll } from "@/lib/clock";
import { workedMinutes } from "@/lib/hr-rules";
import { companyZone, isResponse, json, readJson, requireMobileUser, str } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

async function snapshot(userId: string) {
  const open = await db.attendanceRecord.findFirst({ where: { userId, clockOut: null }, include: { breaks: true } });
  const recent = await db.attendanceRecord.findMany({ where: { userId }, orderBy: { workDate: "desc" }, take: 14, include: { breaks: true } });
  return {
    open: open ? { since: open.clockIn.toISOString(), mode: open.workMode, onBreak: open.breaks.some((b) => !b.endAt), workedMinutes: workedMinutes(open, open.breaks).worked } : null,
    recent: recent.map((r) => ({
      id: r.id, date: r.workDate, clockIn: r.clockIn.toISOString(), clockOut: r.clockOut?.toISOString() ?? null, mode: r.workMode,
      workedMinutes: workedMinutes(r, r.breaks).worked,
    })),
  };
}

export async function GET(req: Request) {
  const a = await requireMobileUser(req, "self.attendance");
  if (isResponse(a)) return a;
  return json(await snapshot(a.user.id));
}

// { action: "in" | "out" | "break_start" | "break_end", mode?: "OFFICE" | "REMOTE" }. Same rules and audit entries as the website.
export async function POST(req: Request) {
  const a = await requireMobileUser(req, "self.attendance");
  if (isResponse(a)) return a;
  const { user } = a;
  const body = await readJson(req);
  const action = str(body.action, 20);
  if (!["in", "out", "break_start", "break_end"].includes(action)) return json({ error: "Unknown action." }, 400);
  try {
    if (action === "in") await clockInAll(db, { organizationId: user.organizationId, userId: user.id, timeZone: await companyZone(user.organizationId), workMode: body.mode === "REMOTE" ? "REMOTE" : "OFFICE" });
    else if (action === "out") await clockOutAll(db, { userId: user.id });
    else if (action === "break_start") await breakStartAll(db, { userId: user.id });
    else await breakEndAll(db, { userId: user.id });
    await audit(user, { action: `attendance.${action}`, entity: "AttendanceRecord", after: { via: "mobile" } });
  } catch (e) {
    if (e instanceof HrError) return json({ error: e.message }, 409);
    throw e;
  }
  return json(await snapshot(user.id));
}
