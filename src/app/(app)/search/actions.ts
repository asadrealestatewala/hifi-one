"use server";

import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchAll, type Group } from "@/lib/search";

export type RecordResults = { groups: Group[] };

// Records for the search box as the person types. Same rules as the Search page: only areas they may view, record scope applied.
export async function searchRecordsAction(q: string): Promise<RecordResults> {
  const user = await requirePermission("dashboard.view");
  const groups = await searchAll(db, { id: user.id, organizationId: user.organizationId, permissions: user.permissions }, String(q ?? "").slice(0, 80));
  return { groups: groups.map((g) => ({ title: g.title, hits: g.hits.slice(0, 3) })) };
}
