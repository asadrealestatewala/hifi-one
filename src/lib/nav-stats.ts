// Small numbers for the menu: your level and daily goals, and how many things need you in each module.
// Cached for a short time per person so the menu never slows a page down.
import { unstable_cache } from "next/cache";
import { db } from "./db";
import { questFor } from "./crm-contacts";

export type NavStats = {
  quest: { level: number; levelName: string; xp: number; levelStartsAt: number; nextLevelAt: number | null; streak: number; goalsDone: number; goalsTotal: number } | null;
  badges: Record<string, number>; // module id -> count of things waiting for this person
};

const load = unstable_cache(async (organizationId: string, userId: string, crm: boolean, projects: boolean): Promise<NavStats> => {
  const now = new Date();
  const [quest, followUps, lateTasks] = await Promise.all([
    crm ? questFor(db, { organizationId, userId }) : null,
    crm ? db.lead.count({ where: { organizationId, assignedToId: userId, clientId: null, stage: { isWon: false, isLost: false }, nextFollowUp: { lte: now } } }) : 0,
    projects ? db.task.count({ where: { assigneeId: userId, status: { not: "DONE" }, dueDate: { lt: now }, project: { organizationId } } }) : 0,
  ]);
  return {
    quest: quest && { level: quest.level, levelName: quest.levelName, xp: quest.xp, levelStartsAt: quest.levelStartsAt, nextLevelAt: quest.nextLevelAt, streak: quest.streak, goalsDone: quest.goals.filter((g) => g.value >= g.target).length, goalsTotal: quest.goals.length },
    badges: { ...(followUps ? { crm: followUps } : {}), ...(lateTasks ? { projects: lateTasks } : {}) },
  };
}, ["nav-stats"], { revalidate: 20 });

export const loadNavStats = (organizationId: string, userId: string, perms: ReadonlySet<string>) => load(organizationId, userId, perms.has("crm.view"), perms.has("projects.view"));
