import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";
import { setRoleMfa } from "./actions";
import { NewRole, RoleCard, type Group } from "./RoleEditor";

export const dynamic = "force-dynamic";

const TITLES: Record<string, string> = {
  dashboard: "Dashboards", settings: "Company settings", bank: "Bank accounts", users: "Users", roles: "Roles", audit: "Audit", crm: "CRM and sales", catalog: "Service catalog",
  projects: "Projects", tasks: "Tasks", self: "Self-service", leave: "Leave", hr: "HR", attendance: "Attendance", payroll: "Payroll", expenses: "Expenses", budget: "Budgets",
  vendors: "Vendors", assets: "Fixed assets", investments: "Investments", reports: "Reports", journal: "Journals", coa: "Chart of accounts", period: "Period closing",
  finance: "Finance", clients: "Clients", content: "Content calendar",
};

function groupPermissions(): Group[] {
  const map = new Map<string, Group>();
  for (const k of ALL_PERMISSIONS) {
    const prefix = k.split(".")[0];
    const g = map.get(prefix) ?? { name: TITLES[prefix] ?? prefix, perms: [] };
    g.perms.push({ key: k, description: (PERMISSIONS as Record<string, string>)[k] });
    map.set(prefix, g);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default async function Roles() {
  const user = await requirePermission("roles.manage");
  const roles = await db.role.findMany({
    where: { organizationId: user.organizationId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } }, users: { select: { user: { select: { totpEnabled: true, active: true } } } } },
  });
  const groups = groupPermissions();
  const isSuper = user.roleKeys.includes("SUPER_ADMIN");
  const grantable = isSuper ? (ALL_PERMISSIONS as string[]) : [...user.permissions];
  const external = ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"];
  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Roles and permissions</h1>
      <p className="text-sm text-muted">
        Changes apply to everyone holding the role from their next sign-in; they are signed out now so nobody keeps old access. You can only grant or remove permissions you hold yourself.
        Every change is recorded in the audit log. The complete matrix is also in docs/ROLES.md.
      </p>
      <div className="space-y-3">
        {roles.map((r) => {
          const lockedReason = r.key === "SUPER_ADMIN" ? "Super Admin always holds every permission and cannot be edited." : external.includes(r.key) ? "Clients, vendors, partners and investors use their own portals and hold no staff permissions." : undefined;
          const without = r.users.filter((u) => u.user.active && !u.user.totpEnabled).length;
          return (
            <div key={r.id} className="space-y-1">
            <RoleCard id={r.id} name={r.name} isSystem={r.isSystem} users={r._count.users} held={r.permissions.map((p) => p.permission.key)} groups={groups} grantable={grantable} locked={Boolean(lockedReason)} lockedReason={lockedReason} />
            {!external.includes(r.key) && (
              <form action={setRoleMfa} className="flex flex-wrap items-center gap-3 px-1 text-xs text-muted">
                <input type="hidden" name="roleId" value={r.id} /><input type="hidden" name="on" value={String(!r.requireMfa)} />
                <span>Two-step verification: <strong className={r.requireMfa ? "text-green-700" : ""}>{r.requireMfa ? "required" : "optional"}</strong>{r.requireMfa && without > 0 && `, ${without} user${without === 1 ? " has" : "s have"} not set it up yet`}</span>
                <button className="underline">{r.requireMfa ? "Make optional" : "Require for this role"}</button>
              </form>
            )}
            </div>
          );
        })}
      </div>
      <NewRole groups={groups} grantable={grantable} />
    </div>
  );
}
