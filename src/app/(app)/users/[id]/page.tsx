import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import UserActions from "./UserActions";

export const dynamic = "force-dynamic";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("users.manage");
  const { id } = await params;
  const u = await db.user.findFirst({ where: { id, organizationId: me.organizationId }, include: { roles: { include: { role: true } } } });
  if (!u) notFound();
  const roles = await db.role.findMany({ where: { organizationId: me.organizationId, key: { notIn: ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"] } }, orderBy: { name: "asc" } });
  const recent = await db.auditLog.findMany({ where: { organizationId: me.organizationId, actorId: u.id, action: { startsWith: "auth." } }, orderBy: { createdAt: "desc" }, take: 8 });
  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/users" className="text-sm text-muted hover:underline">← All users</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{u.name} <span className="text-base font-normal text-muted">{u.email}</span></h1>
      <p className="text-sm text-muted">{u.userType.toLowerCase()} · {u.active ? "active" : "inactive"} · two-step {u.totpEnabled ? "on" : "off"}{u.lastLoginAt && ` · last sign-in ${u.lastLoginAt.toLocaleString()}`}</p>
      <UserActions
        userId={u.id} active={u.active} isStaff={u.userType === "EMPLOYEE"} mfaOn={u.totpEnabled}
        roles={roles.map((r) => ({ key: r.key, name: r.name }))} held={u.roles.map((r) => r.role.key)}
      />
      <section className="card">
        <h2 className="font-semibold mb-2">Recent sign-in activity</h2>
        {recent.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="text-sm">{recent.map((a) => <li key={a.id} className="border-t border-border py-1 first:border-0"><span className="text-xs text-muted">{a.createdAt.toLocaleString()}</span> {a.action}</li>)}</ul>}
      </section>
    </div>
  );
}
