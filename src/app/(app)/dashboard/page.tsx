import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requirePermission("dashboard.view");
  const [users, branches, banks] = await Promise.all([
    db.user.count({ where: { organizationId: user.organizationId, active: true } }),
    db.branch.count({ where: { organizationId: user.organizationId, active: true } }),
    db.bankAccount.count({ where: { organizationId: user.organizationId, active: true } }),
  ]);
  const cards = [
    { label: "Active users", value: users },
    { label: "Branches", value: branches },
    { label: "Bank accounts", value: banks },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {user.name}</h1>
        <p className="text-sm text-muted">
          Foundation phase: sign-in, roles, audit trail and company settings are live. CRM, projects, finance and HR
          modules come next and will appear here as they are built.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <p className="text-xs font-semibold text-muted">{c.label}</p>
            <p className="text-3xl font-bold mt-1">{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
