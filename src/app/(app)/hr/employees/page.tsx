import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import CreateEmployeeForm from "./CreateEmployeeForm";
import { Avatar, Chips, Empty, NewButton, PageHeader, SearchBox, Stat, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";

export const dynamic = "force-dynamic";

type SP = { status?: string; q?: string; new?: string };

export default async function Employees({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("hr.view");
  const sp = await searchParams;
  const canManage = user.permissions.has("hr.manage");
  const [profiles, users, roles] = await Promise.all([
    db.employeeProfile.findMany({ where: { organizationId: user.organizationId }, orderBy: { employeeNo: "asc" } }),
    db.user.findMany({ where: { organizationId: user.organizationId, userType: "EMPLOYEE" }, include: { roles: { include: { role: true } } } }),
    sp.new && canManage ? db.role.findMany({ where: { organizationId: user.organizationId, key: { notIn: ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"] } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  type Row = { key: string; href: string | null; no: string; name: string; email: string; roles: string; location: string; status: string };
  const rows: Row[] = [
    ...users.filter((u) => !profiles.some((p) => p.userId === u.id)).map((u) => ({ key: u.id, href: null, no: "-", name: u.name, email: u.email, roles: u.roles.map((r) => r.role.name).join(", "), location: "", status: "NO_PROFILE" })),
    ...profiles.map((p) => { const u = byId.get(p.userId); return { key: p.id, href: `/hr/employees/${p.id}`, no: p.employeeNo, name: u?.name ?? "", email: u?.email ?? "", roles: u?.roles.map((r) => r.role.name).join(", ") ?? "", location: p.workLocation, status: p.status }; }),
  ];
  const statuses = [...new Set(rows.map((r) => r.status))];
  const status = statuses.includes(sp.status ?? "") ? sp.status! : "all";
  const q = sp.q?.trim().toLowerCase();
  const shown = rows.filter((r) => (status === "all" || r.status === status) && (!q || `${r.name} ${r.email} ${r.no} ${r.roles}`.toLowerCase().includes(q)));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status: status === "all" ? undefined : status, q: sp.q?.trim(), ...over })) if (v) p.set(k, v); const t = p.toString(); return `/hr/employees${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Employees" subtitle="Your team, their roles and where they work." actions={canManage ? <NewButton href={href({ new: "1" })}>Add employee</NewButton> : undefined} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="People" value={rows.length} />
        <Stat label="Active" value={rows.filter((r) => r.status === "ACTIVE").length} />
        <Stat label="Without HR profile" value={rows.filter((r) => r.status === "NO_PROFILE").length} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={sp.q?.trim()} placeholder="Search name, email, number or role" hidden={{ status: status === "all" ? undefined : status }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: rows.length, href: href({ status: undefined }) }, ...statuses.map((s) => ({ key: s, label: s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), count: rows.filter((r) => r.status === s).length, href: href({ status: s }) }))]} />
      </div>
      {shown.length === 0 ? <Empty title="No employees match">Try a different search.</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Employee</th><th className="pr-4">Roles</th><th className="pr-4">Location</th><th className="pr-4">Status</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const who = <><Avatar name={r.name} /><span><span className={`block font-medium ${r.href ? "hover:underline" : ""}`}>{r.name}</span><span className="text-xs text-muted">{r.no} · {r.email}</span></span></>;
                return (
                  <tr key={r.key} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-2.5">{r.href ? <Link href={r.href} className="flex items-center gap-3">{who}</Link> : <div className="flex items-center gap-3">{who}</div>}</td>
                    <td className="pr-4 text-muted">{r.roles}</td>
                    <td className="pr-4 text-muted">{r.location.toLowerCase()}</td>
                    <td className="pr-4">{r.status === "NO_PROFILE" ? <span className="text-xs text-muted">No HR profile</span> : <StatusBadge status={r.status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canManage && sp.new && (
        <Drawer title="Add employee" closeTo={href({ new: undefined })}>
          <CreateEmployeeForm roles={roles.map((r) => ({ key: r.key, name: r.name }))} managers={users.map((u) => ({ id: u.id, name: u.name }))} />
        </Drawer>
      )}
    </div>
  );
}
