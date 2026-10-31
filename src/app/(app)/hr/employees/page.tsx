import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { STAFF_STATUSES, staffWhere, type StaffFilters } from "@/lib/staff";
import { AppliedFilters, Avatar, Chips, Empty, NewButton, PageHeader, Pager, SearchBox, Stat, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import StaffForm from "./StaffForm";
import { createProfileAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; dep?: string; designation?: string; role?: string; campaign?: string; project?: string; archived?: string; page?: string; from?: string; new?: string; sort?: string };
const SORTS = { id: { label: "Employee ID", by: [{ employeeNo: "asc" as const }] }, name: { label: "Name", by: [{ user: { name: "asc" as const } }] }, joined: { label: "Newest joiners", by: [{ joinDate: { sort: "desc" as const, nulls: "last" as const } }] }, designation: { label: "Designation", by: [{ designation: { sort: "asc" as const, nulls: "last" as const } }] } };
const KEYS = ["q", "status", "dep", "designation", "role", "campaign", "project", "archived", "from", "sort"] as const;

// The staff directory. Every filter lives in the address, so dashboard cards can open it pre-filtered.
export default async function Employees({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("hr.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("hr.manage");
  const q = sp.q?.trim();
  const status = (STAFF_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const filters: StaffFilters = { q, status, departmentId: sp.dep, designation: sp.designation, roleKey: sp.role, campaignId: sp.campaign, projectId: sp.project, archived: sp.archived === "1" };
  const pg = paging(sp.page);
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "id") as keyof typeof SORTS;
  const where = await staffWhere(db, org, filters);
  const base = await staffWhere(db, org, { archived: false });
  const [rows, matched, byStatus, departments, roles, campaign, project, managers, archivedCount] = await Promise.all([
    db.employeeProfile.findMany({ where, orderBy: [...SORTS[sort].by, { id: "asc" }], skip: pg.skip, take: pg.take, include: { user: { select: { id: true, name: true, email: true, phone: true, departmentId: true, roles: { select: { role: { select: { name: true } } } } } } } }),
    db.employeeProfile.count({ where }),
    db.employeeProfile.groupBy({ by: ["status"], where: base, _count: true }),
    db.department.findMany({ where: { organizationId: org }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.role.findMany({ where: { organizationId: org, key: { notIn: ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"] } }, orderBy: { name: "asc" }, select: { key: true, name: true } }),
    sp.campaign ? db.campaign.findFirst({ where: { id: sp.campaign, organizationId: org }, select: { name: true } }) : null,
    sp.project ? db.project.findFirst({ where: { id: sp.project, organizationId: org }, select: { name: true } }) : null,
    canManage && sp.new ? db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.employeeProfile.count({ where: { organizationId: org, archivedAt: { not: null } } }),
  ]);
  // Staff accounts created on the Users screen have no HR record yet; they are listed so HR can complete them
  const noProfile = canManage ? await db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", employeeProfile: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const dep = new Map(departments.map((d) => [d.id, d.name]));
  const count = new Map(byStatus.map((s) => [s.status, s._count]));
  const total = byStatus.reduce((n, s) => n + s._count, 0);
  const current: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, k === "q" ? q : k === "status" ? status : sp[k]]));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/hr/employees${t ? `?${t}` : ""}`; };
  const without = (k: string) => href({ [k]: undefined });
  const applied = [
    q && { label: `“${q}”`, removeHref: without("q") },
    sp.dep && { label: `Department: ${dep.get(sp.dep) ?? "unknown"}`, removeHref: without("dep") },
    sp.designation && { label: `Designation: ${sp.designation}`, removeHref: without("designation") },
    sp.role && { label: `Role: ${roles.find((r) => r.key === sp.role)?.name ?? sp.role}`, removeHref: without("role") },
    sp.campaign && { label: `Campaign: ${campaign?.name ?? "unknown"}`, removeHref: without("campaign") },
    sp.project && { label: `Project: ${project?.name ?? "unknown"}`, removeHref: without("project") },
    sp.archived === "1" && { label: "Archived", removeHref: without("archived") },
  ].filter(Boolean) as { label: string; removeHref: string }[];
  return (
    <div className="space-y-5">
      <PageHeader title="Staff directory" subtitle="Everyone who works here: roles, departments, assignments and contact details." actions={<>
        <a href={`/hr/employees/export?${new URLSearchParams(Object.entries(current).filter(([k, v]) => v && k !== "from") as [string, string][]).toString()}`} className="btn-ghost">Export CSV</a>
        {canManage && <NewButton href={href({ new: "1" })}>Add staff member</NewButton>}
      </>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Staff on record" value={total} href="/hr/employees" />
        <Stat label="Active" value={count.get("ACTIVE") ?? 0} href="/hr/employees?status=ACTIVE" />
        <Stat label="Inactive" value={count.get("INACTIVE") ?? 0} hint={`${count.get("EXITED") ?? 0} exited`} href="/hr/employees?status=INACTIVE" />
        <Stat label="Archived" value={archivedCount} href="/hr/employees?archived=1" />
      </div>
      <AppliedFilters items={applied} clearHref="/hr/employees" backHref={sp.from === "dashboard" ? "/dashboard?tab=people" : undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search name, email, number, ID or designation" hidden={{ ...current, q: undefined }} />
        {sp.archived !== "1" && <Chips current={status ?? "all"} items={[{ key: "all", label: "All", count: total, href: href({ status: undefined, page: undefined }) }, ...STAFF_STATUSES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase(), count: count.get(s) ?? 0, href: href({ status: s }) }))]} />}
        <form className="flex flex-wrap gap-2" aria-label="More filters">
          {Object.entries(current).filter(([k, v]) => v && !["dep", "role", "sort"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <select name="sort" defaultValue={sort} aria-label="Sort by" className="input !w-auto">{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v.label}</option>)}</select>
          <select name="dep" defaultValue={sp.dep ?? ""} aria-label="Department" className="input !w-auto"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select name="role" defaultValue={sp.role ?? ""} aria-label="Role" className="input !w-auto"><option value="">All roles</option>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
          <button className="btn-ghost">Apply</button>
        </form>
      </div>
      {rows.length === 0 ? <Empty title={applied.length || status ? "No staff match these filters" : "No staff records yet"}>{applied.length || status ? <Link className="underline" href="/hr/employees">Clear the filters</Link> : canManage ? "Add the first person with Add staff member." : "Staff records will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Staff member</th><th className="pr-4">Designation</th><th className="pr-4">Department</th><th className="pr-4">Roles</th><th className="pr-4">Contact</th><th className="pr-4">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-2.5"><Link href={`/hr/employees/${r.id}`} className="flex items-center gap-3"><Avatar name={r.user.name} userId={r.user.id} /><span><span className="block font-medium hover:underline">{r.user.name}</span><span className="text-xs text-muted">{r.employeeNo}</span></span></Link></td>
                  <td className="pr-4">{r.designation ?? <span className="text-muted">Not set</span>}</td>
                  <td className="pr-4 text-muted">{(r.departmentId ?? r.user.departmentId) ? dep.get((r.departmentId ?? r.user.departmentId)!) : ""}</td>
                  <td className="pr-4 text-muted">{r.user.roles.map((x) => x.role.name).join(", ")}</td>
                  <td className="pr-4 text-xs text-muted">{r.user.email ?? ""}{r.user.email && r.user.phone ? <br /> : null}{r.user.phone ?? ""}{!r.user.email && !r.user.phone && "Not recorded"}</td>
                  <td className="pr-4">{r.archivedAt ? <StatusBadge status="ARCHIVED" /> : <StatusBadge status={r.status} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
        </div>
      )}
      {noProfile.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Accounts without a staff record ({noProfile.length})</h2>
          <p className="text-sm text-muted">These people can sign in but have no employee ID or HR details yet.</p>
          <ul className="flex flex-wrap gap-2">{noProfile.map((u) => <li key={u.id}><form action={createProfileAction}><input type="hidden" name="userId" value={u.id} /><button className="btn-ghost !py-1">Create record for {u.name}</button></form></li>)}</ul>
        </section>
      )}
      {canManage && sp.new && (
        <Drawer title="Add staff member" closeTo={href({ new: undefined })}>
          <StaffForm mode="create" roles={roles} departments={departments} managers={managers} canSensitive={user.permissions.has("hr.view_sensitive")} closeTo={href({ new: undefined })} />
        </Drawer>
      )}
    </div>
  );
}
