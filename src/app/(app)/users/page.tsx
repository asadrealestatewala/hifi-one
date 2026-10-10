import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Users() {
  const user = await requirePermission("users.view");
  const users = await db.user.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { name: "asc" },
    include: { roles: { include: { role: true } }, branch: true },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Users & Roles</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-2 pr-4">Name</th>
              <th className="pr-4">Email</th>
              <th className="pr-4">Roles</th>
              <th className="pr-4">Branch</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="py-2 pr-4 font-medium">{u.name}</td>
                <td className="pr-4">{u.email}</td>
                <td className="pr-4">{u.roles.map((r) => r.role.name).join(", ")}</td>
                <td className="pr-4">{u.branch?.name ?? ""}</td>
                <td>{u.active ? "Active" : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
