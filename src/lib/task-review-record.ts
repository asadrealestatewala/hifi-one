// The review record kept with every move into and out of In review. Lives apart from task-review.ts so tasks.ts can call it
// inside its transaction without importing the approval actions (which import tasks.ts).
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type ReviewOutcome = "APPROVED" | "REVISION" | "MOVED" | "WITHDRAWN";
export const OUTCOME_LABEL: Record<ReviewOutcome, string> = { APPROVED: "Approved", REVISION: "Revision needed", MOVED: "Status changed", WITHDRAWN: "Taken back by the sender" };

// Called from changeTaskStatus inside its transaction. `isManager` is whether the actor manages the project.
export async function recordReviewMove(tx: Tx, p: { taskId: string; from: string; to: string; actorId: string; isManager: boolean; now: Date; outcome?: ReviewOutcome; comment?: string | null }) {
  if (p.from === "REVIEW") {
    const open = await tx.taskReview.findFirst({ where: { taskId: p.taskId, respondedAt: null }, orderBy: { submittedAt: "desc" } });
    if (open) {
      const outcome: ReviewOutcome = p.outcome
        ?? (p.to === "DONE" && p.isManager ? "APPROVED" : open.submittedById === p.actorId && !p.isManager ? "WITHDRAWN" : "MOVED");
      await tx.taskReview.update({ where: { id: open.id }, data: { respondedAt: p.now, respondedById: p.actorId, outcome, comment: p.comment ?? null } });
    }
  }
  if (p.to === "REVIEW") {
    // Anything left open (should not happen) is closed first, so a task has at most one open review
    await tx.taskReview.updateMany({ where: { taskId: p.taskId, respondedAt: null }, data: { respondedAt: p.now, respondedById: p.actorId, outcome: "MOVED" } });
    await tx.taskReview.create({ data: { taskId: p.taskId, submittedById: p.actorId, submittedAt: p.now } });
  }
}

