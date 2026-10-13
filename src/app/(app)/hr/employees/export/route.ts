import { requirePermission } from "@/lib/auth";
import { tableCsv } from "@/lib/crm-contacts";
import { db } from "@/lib/db";
import { STAFF_STATUSES, staffWhere } from "@/lib/staff";

export const dynamic = "force-dynamic";

// The staff directory for the filters on screen, as CSV (up to 5,000 rows). Never includes CNIC, bank or personal details.
export async function GET(req: Request) {
  const user = await requirePermission("hr.view");
  const sp = new URL(req.url).searchParams;
  const g = (k: string) => sp.get(k) || undefined;
  const status = (STAFF_STATUSES as readonly string[]).includes(sp.get("status") ?? "") ? sp.get("status")! : undefined;
  const where = await staffWhere(db, user.organizationId, { q: g("q")?.trim(), status, departmentId: g("dep"), designation: g("designation"), roleKey: g("role"), campaignId: g("campaign"), projectId: g("project"), archived: sp.get("archived") === "1" });
  const rows = await db.employeeProfile.findMany({ where, orderBy: { employeeNo: "asc" }, take: 5000, include: { user: { select: { name: true, email: true, phone: true, department: { select: { name: true } }, manager: { select: { name: true } }, roles: { select: { role: { select: { name: true } } } } } } } });
  const csv = tableCsv(
    ["Employee ID", "Name", "Designation", "Department", "Roles", "Official email", "Contact number", "Employment type", "Joining date", "Reporting manager", "Status"],
    rows.map((r) => [r.employeeNo, r.user.name, r.designation, r.user.department?.name, r.user.roles.map((x) => x.role.name).join("; "), r.user.email, r.user.phone, r.employmentType, r.joinDate?.toISOString().slice(0, 10), r.user.manager?.name, r.archivedAt ? "ARCHIVED" : r.status]),
  );
  return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="staff-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
