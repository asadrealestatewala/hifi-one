import { requirePermission } from "@/lib/auth";
import { listContacts, toCsv } from "@/lib/crm-contacts";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// A CSV of exactly the contacts this person can see for the filters on screen (up to 5,000 rows). Formula characters are defused.
export async function GET(req: Request) {
  const user = await requirePermission("crm.view");
  const sp = new URL(req.url).searchParams;
  const tab = sp.get("tab");
  const out = await listContacts(db, { id: user.id, organizationId: user.organizationId, permissions: user.permissions }, {
    tab: tab === "organizations" || tab === "contacts" ? tab : "all", q: sp.get("q") ?? undefined, category: sp.get("category") ?? undefined, ownerId: sp.get("owner") ?? undefined, tag: sp.get("tag") ?? undefined,
    source: sp.get("source") ?? undefined, archived: sp.get("archived") === "1", sort: "name", dir: "asc", pageSize: 100,
  });
  // Collect every page up to the cap
  const rows = [...out.rows];
  for (let page = 2; page <= Math.min(out.pages, 50); page++) {
    const more = await listContacts(db, { id: user.id, organizationId: user.organizationId, permissions: user.permissions }, { tab: tab === "organizations" || tab === "contacts" ? tab : "all", q: sp.get("q") ?? undefined, category: sp.get("category") ?? undefined, ownerId: sp.get("owner") ?? undefined, tag: sp.get("tag") ?? undefined, source: sp.get("source") ?? undefined, archived: sp.get("archived") === "1", sort: "name", dir: "asc", pageSize: 100, page });
    rows.push(...more.rows);
  }
  return new Response("﻿" + toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
