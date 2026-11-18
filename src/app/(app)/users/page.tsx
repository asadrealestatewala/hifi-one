import Link from "next/link";
import { PageHeader } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import Avatar from "@/components/ui/Avatar";
import { requirePermission } from "@/lib/auth";
import { startViewAsPerson } from "../view-as/actions";
import ViewAsPersonButton from "./ViewAsPersonButton";
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
      <PageHeader tabs={<ScreenTabs group="admin-people" current="/users" />} title="Users & roles" subtitle="Everyone who can sign in, the roles they hold and whether two-step is on. A Super Admin can open any person's own view, read-only, with View as." />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Name</th><th className="pr-4">Email</th><th className="pr-4">Type</th><th className="pr-4">Roles</th><th className="pr-4">2-step</th><th className="pr-4">Status</th>{user.realSuperAdmin && <th>View</th>}</tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border transition hover:bg-hover/50">
                <td className="py-2 pr-4 font-medium"><span className="flex items-center gap-2"><Avatar name={u.name} userId={u.userType === "EMPLOYEE" ? u.id : null} size={28} />{canManage ? <Link className="hover:underline" href={`/users/${u.id}`}>{u.name}</Link> : u.name}</span></td>
                <td className="pr-4">{u.email}</td><td className="pr-4">{u.userType.toLowerCase()}</td>
                <td className="pr-4">{u.roles.map((r) => r.role.name).join(", ")}</td>
                <td className="pr-4">{u.totpEnabled ? "on" : <span className="text-muted">off</span>}</td>
                <td className="pr-4">{u.active ? "Active" : <span className="text-muted">Inactive</span>}</td>
                {user.realSuperAdmin && <td>{u.active && u.id !== user.id && !u.roles.some((r) => r.role.key === "SUPER_ADMIN") ? <ViewAsPersonButton userId={u.id} name={u.name} start={startViewAsPerson} /> : null}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && <CreateUserForm roles={roles.map((r) => ({ key: r.key, name: r.name }))} />}
    </div>
  );
}
