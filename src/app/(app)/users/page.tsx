import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import CreateUserForm from "./CreateUserForm";

export const dynamic = "force-dynamic";

export default async function Users() {
  const user = await requirePermission("users.view");
  const canManage = user.permissions.has("users.manage");
  const [users, roles] = await Promise.all([
    db.user.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ userType: "asc" }, { name: "asc" }], include: { roles: { include: { role: true } } } }),
    db.role.findMany({ where: { organizationId: user.organizationId, key: { notIn: ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"] } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Users</h1>
        {user.permissions.has("roles.manage") && <Link href="/roles" className="btn-ghost">Manage roles</Link>}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Name</th><th className="pr-4">Email</th><th className="pr-4">Type</th><th className="pr-4">Roles</th><th className="pr-4">2-step</th><th>Status</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="py-2 pr-4 font-medium">{canManage ? <Link className="hover:underline" href={`/users/${u.id}`}>{u.name}</Link> : u.name}</td>
                <td className="pr-4">{u.email}</td><td className="pr-4">{u.userType.toLowerCase()}</td>
                <td className="pr-4">{u.roles.map((r) => r.role.name).join(", ")}</td>
                <td className="pr-4">{u.totpEnabled ? "on" : <span className="text-muted">off</span>}</td>
                <td>{u.active ? "Active" : <span className="text-muted">Inactive</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && <CreateUserForm roles={roles.map((r) => ({ key: r.key, name: r.name }))} />}
    </div>
  );
}
