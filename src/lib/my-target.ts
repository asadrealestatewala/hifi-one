// "My target today" on My day (HR's Required Changes, item 7): the person's own daily targets against what they have
// done so far today, counted by the company-local day. Two sources, both set by a manager: the daily Sales targets
// (Sales activity screen; connected calls count once a manager verifies them) and, for sales agents, the Prospector
// daily target (field agents: visits; office agents: prospects added plus outreach, as the end-of-day report counts it).
// Returns no lines when nobody set a target for the person. Free of Next.js imports so it can be tested.
import type { PrismaClient } from "@prisma/client";
import { METRICS, METRIC_LABEL, countFor } from "./crm";
import { dayBounds } from "./daily-reports";
import { agentProfile } from "./field-visits";

type Db = PrismaClient;
export type TargetLine = { key: string; label: string; done: number; target: number; pending?: number; href: string };

export async function myTargetToday(db: Db, p: { organizationId: string; userId: string; date: string; timeZone: string }): Promise<TargetLine[]> {
  const b = dayBounds(p.date, p.timeZone);
  const [targets, hasProfile] = await Promise.all([
    db.salesTarget.findMany({ where: { organizationId: p.organizationId, userId: p.userId, daily: { not: null } }, select: { metric: true, daily: true } }),
    db.salesAgentProfile.findUnique({ where: { organizationId_userId: { organizationId: p.organizationId, userId: p.userId } }, select: { userId: true } }),
  ]);
  const lines: TargetLine[] = [];
  if (targets.length > 0) {
    const counts = (await countFor(db, p.organizationId, b.gte, new Date(b.lt.getTime() - 1))).get(p.userId);
    for (const m of METRICS) {
      const t = targets.find((x) => x.metric === m);
      if (!t || !t.daily) continue;
      lines.push({ key: m, label: METRIC_LABEL[m], done: counts?.[m] ?? 0, target: t.daily, ...(m === "CONNECTED_CALLS" && counts?.connectedPending ? { pending: counts.connectedPending } : {}), href: "/leads" });
    }
  }
  if (hasProfile) {
    const agent = await agentProfile(db, p.organizationId, p.userId);
    if (agent.dailyVisitTarget > 0) {
      if (agent.kind === "FIELD") {
        const done = await db.prospectVisit.count({ where: { organizationId: p.organizationId, agentId: p.userId, visitedAt: { gte: b.gte, lt: b.lt } } });
        lines.push({ key: "VISITS", label: agent.productName ? `${agent.productName} visits` : "Field visits", done, target: agent.dailyVisitTarget, href: "/field" });
      } else {
        const [added, outreach] = await Promise.all([
          db.prospect.count({ where: { organizationId: p.organizationId, addedById: p.userId, createdAt: { gte: b.gte, lt: b.lt } } }),
          db.prospectOutreach.count({ where: { organizationId: p.organizationId, userId: p.userId, createdAt: { gte: b.gte, lt: b.lt } } }),
        ]);
        lines.push({ key: "PROSPECTING", label: agent.productName ? `${agent.productName} prospects and outreach` : "Prospects and outreach", done: added + outreach, target: agent.dailyVisitTarget, href: "/leads/prospector" });
      }
    }
  }
  return lines;
}
