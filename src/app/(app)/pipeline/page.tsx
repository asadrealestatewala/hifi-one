import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/leads";
import { formatMoney } from "@/lib/money";
import Board from "./Board";

export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const user = await requirePermission("crm.view");
  const [stages, leads] = await Promise.all([
    db.pipelineStage.findMany({ where: { organizationId: user.organizationId }, orderBy: { sortOrder: "asc" } }),
    db.lead.findMany({ where: leadScope(user), orderBy: { updatedAt: "desc" }, take: 500 }),
  ]);
  const now = Date.now();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <p className="text-sm text-muted">Drag a card to another column, or use the stage menu on the card. Changes save immediately.</p>
      </div>
      <Board
        key={leads.map((l) => `${l.id}:${l.stageId}`).join(",")}
        canEdit={user.permissions.has("crm.edit")}
        stages={stages.map((s) => ({ id: s.id, name: s.name, isWon: s.isWon }))}
        cards={leads.map((l) => ({
          id: l.id,
          stageId: l.stageId,
          name: l.name,
          company: l.company,
          value: l.dealValue ? formatMoney(l.dealValue, l.currency) : null,
          days: Math.floor((now - l.stageChangedAt.getTime()) / 86400000),
        }))}
      />
    </div>
  );
}
