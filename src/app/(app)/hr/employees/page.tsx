import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import CreateEmployeeForm from "./CreateEmployeeForm";

export const dynamic = "force-dynamic";

export default async function Employees() {
  const user = await requirePermission("hr.view");
  const canManage = user.permissions.has("hr.manage");
  const [profiles, users, roles] = await Promise.all([
    db.employeeProfile.findMany({ where: { organizationId: user.organizationId }, orderBy: { employeeNo: "asc" } }),
    db.user.findMany({ where: { organizationId: user.organizationId, userType: "EMPLOYEE" }, include: { roles: { include: { role: true } } } }),
    db.role.findMany({ where: { organizationId: user.organizationId, key: { notIn: ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"] } }, orderBy: { name: "asc" } }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Employees</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">No.</th><th className="pr-4">Name</th><th className="pr-4">Email</th><th className="pr-4">Roles</th><th className="pr-4">Location</th><th>Status</th></tr></thead>
          <tbody>
            {users.filter((u) => !profiles.some((p) => p.userId === u.id)).map((u) => (
              <tr key={u.id} className="border-t border-border"><td className="py-2 pr-4 text-muted">-</td><td className="pr-4">{u.name}</td><td className="pr-4">{u.email}</td><td className="pr-4">{u.roles.map((r) => r.role.name).join(", ")}</td><td className="pr-4"></td><td>No HR profile</td></tr>
            ))}
            {profiles.map((p) => {
              const u = byId.get(p.userId);
              return (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2 pr-4 text-muted">{p.employeeNo}</td>
                  <td className="pr-4 font-medium"><Link href={`/hr/employees/${p.id}`} className="hover:underline">{u?.name}</Link></td>
                  <td className="pr-4">{u?.email}</td>
                  <td className="pr-4">{u?.roles.map((r) => r.role.name).join(", ")}</td>
                  <td className="pr-4">{p.workLocation.toLowerCase()}</td>
                  <td>{p.status.toLowerCase()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canManage && <CreateEmployeeForm roles={roles.map((r) => ({ key: r.key, name: r.name }))} managers={users.map((u) => ({ id: u.id, name: u.name }))} />}
    </div>
  );
}
