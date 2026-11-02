import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { HrError, cancelLeave, leaveBalances, requestLeave } from "@/lib/hr";
import { dateInZone } from "@/lib/hr-rules";
import { notify } from "@/lib/notifications";
import { companyZone, isResponse, json, readJson, requireMobileUser, str } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

async function snapshot(user: { id: string; organizationId: string }, zone: string) {
  const year = dateInZone(new Date(), zone).slice(0, 4);
  const [balances, requests, types] = await Promise.all([
    leaveBalances(db, user.organizationId, user.id, year),
    db.leaveRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30, include: { leaveType: { select: { name: true } } } }),
    db.leaveType.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    year, types,
    balances: balances.map((b) => ({ type: b.type.name, allowance: b.allowance, approved: b.approved, pending: b.pending, remaining: b.remaining, available: b.available })),
    requests: requests.map((r) => ({ id: r.id, type: r.leaveType.name, startDate: r.startDate, endDate: r.endDate, days: Number(r.days), status: r.status, reason: r.reason, decisionNote: r.decisionNote })),
  };
}

export async function GET(req: Request) {
  const a = await requireMobileUser(req, "self.leave");
  if (isResponse(a)) return a;
  return json(await snapshot(a.user, await companyZone(a.user.organizationId)));
}

// { leaveTypeId, startDate, endDate, reason? } files a request; { cancelId } cancels one of your own. Same rules as the website.
export async function POST(req: Request) {
  const a = await requireMobileUser(req, "self.leave");
  if (isResponse(a)) return a;
  const { user } = a;
  const zone = await companyZone(user.organizationId);
  const body = await readJson(req);
  try {
    if (typeof body.cancelId === "string") {
      await cancelLeave(db, { requestId: body.cancelId, userId: user.id, today: dateInZone(new Date(), zone) });
      await audit(user, { action: "leave.cancel", entity: "LeaveRequest", entityId: body.cancelId, after: { via: "mobile" } });
    } else {
      const r = await requestLeave(db, {
        organizationId: user.organizationId, userId: user.id, leaveTypeId: str(body.leaveTypeId, 60),
        startDate: str(body.startDate, 10), endDate: str(body.endDate, 10), reason: str(body.reason, 500),
      });
      await audit(user, { action: "leave.request", entity: "LeaveRequest", entityId: r.id, after: { start: r.startDate, end: r.endDate, days: r.days.toString(), via: "mobile" } });
      const me = await db.user.findUnique({ where: { id: user.id }, select: { managerId: true } });
      if (me?.managerId) await notify(db, me.managerId, { kind: "leave.request", title: `${user.name} requested leave`, body: `${r.startDate} to ${r.endDate} (${r.days.toString()} days)`, link: "/me/leave", dedupeKey: `leave:${r.id}` });
    }
  } catch (e) {
    if (e instanceof HrError) return json({ error: e.message }, 409);
    throw e;
  }
  return json(await snapshot(user, zone));
}
