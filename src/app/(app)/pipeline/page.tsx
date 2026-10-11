import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { leadScore } from "@/lib/crm";
import { db } from "@/lib/db";
import { dec } from "@/lib/ledger-math";
import { leadScope } from "@/lib/leads";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui";
import Board from "./Board";

export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const user = await requirePermission("crm.view");
  const org = user.organizationId;
  const [stages, leads, campaigns] = await Promise.all([
    db.pipelineStage.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" } }),
    db.lead.findMany({ where: leadScope(user), orderBy: { updatedAt: "desc" }, take: 500, include: { stage: true } }),
    db.campaign.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
  ]);
  const ownerIds = [...new Set(leads.map((l) => l.assignedToId).filter(Boolean) as string[])];
  const owners = new Map((await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const camp = new Map(campaigns.map((c) => [c.id, c.name]));
  const now = Date.now();
  // Column totals per currency (never added across currencies)
  const totals: Record<string, string> = {};
  for (const s of stages) {
    const by = new Map<string, ReturnType<typeof dec>>();
    for (const l of leads.filter((x) => x.stageId === s.id && x.dealValue)) by.set(l.currency, (by.get(l.currency) ?? dec(0)).add(l.dealValue!.toString()));
    totals[s.id] = [...by].map(([c, v]) => formatMoney(v.toString(), c)).join(" + ");
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Opportunities" subtitle="Drag a card to another column, or use the stage menu on it. Moving a deal to Closed Won starts the controlled conversion; changes save immediately."
        actions={<><Link href="/leads" className="btn-ghost">List view</Link><Link href="/leads/lists" className="btn-ghost">Smart lists</Link></>} />
      <Board
        key={leads.map((l) => `${l.id}:${l.stageId}`).join(",")}
        canEdit={user.permissions.has("crm.edit")}
        stages={stages.map((s) => ({ id: s.id, name: s.name, isWon: s.isWon, probability: s.probability }))}
        totals={totals}
        cards={leads.map((l) => ({
          id: l.id, stageId: l.stageId, name: l.name, company: l.company, value: l.dealValue ? formatMoney(l.dealValue, l.currency) : null,
          days: Math.floor((now - l.stageChangedAt.getTime()) / 86400000), owner: l.assignedToId ? owners.get(l.assignedToId) ?? null : null,
          campaign: l.campaignId ? camp.get(l.campaignId) ?? null : null, followUp: l.nextFollowUp ? l.nextFollowUp.toISOString().slice(0, 10) : null,
          overdue: Boolean(l.nextFollowUp && l.nextFollowUp.getTime() < now), score: leadScore(l).score, service: l.serviceInterest,
        }))}
      />
    </div>
  );
}
