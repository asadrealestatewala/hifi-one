import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { secretStrength, type SecurityFinding } from "@/lib/mfa-policy";

export const dynamic = "force-dynamic";

const COLOR = { ok: "text-green-700", warn: "text-amber-600", fail: "text-brand" } as const;
const MARK = { ok: "OK", warn: "Check", fail: "Fix" } as const;

// A live checklist of the things that most often go wrong. Every line states what was actually checked.
export default async function SecurityChecklist() {
  const user = await requirePermission("audit.view");
  const org = user.organizationId;
  const [roles, supers, staff] = await Promise.all([
    db.role.findMany({ where: { organizationId: org }, include: { users: { select: { user: { select: { active: true, totpEnabled: true } } } } } }),
    db.user.count({ where: { organizationId: org, active: true, roles: { some: { role: { key: "SUPER_ADMIN" } } } } }),
    db.user.findMany({ where: { organizationId: org, active: true, userType: "EMPLOYEE" }, select: { totpEnabled: true, mustChangePassword: true } }),
  ]);
  const internal = roles.filter((r) => !["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"].includes(r.key));
  const sensitive = internal.filter((r) => ["SUPER_ADMIN", "CEO", "FINANCE_MANAGER", "ACCOUNTANT", "HR_MANAGER"].includes(r.key));
  const notRequired = sensitive.filter((r) => !r.requireMfa);
  const gaps = internal.filter((r) => r.requireMfa).flatMap((r) => r.users.filter((u) => u.user.active && !u.user.totpEnabled)).length;
  const production = process.env.NODE_ENV === "production";
  const findings: SecurityFinding[] = [
    secretStrength(process.env.SESSION_SECRET),
    notRequired.length === 0
      ? { id: "mfa-roles", level: "ok", title: "Two-step verification for sensitive roles", detail: "Required for Super Admin, CEO, Finance Manager, Accountant and HR Manager." }
      : { id: "mfa-roles", level: "warn", title: "Two-step verification for sensitive roles", detail: `Not required for: ${notRequired.map((r) => r.name).join(", ")}. Turn it on under Roles & Permissions.` },
    gaps === 0
      ? { id: "mfa-users", level: "ok", title: "Everyone in a protected role has set it up", detail: "No active user is waiting to enrol." }
      : { id: "mfa-users", level: "warn", title: "Users who must still set up two-step verification", detail: `${gaps} active user${gaps === 1 ? "" : "s"} will be taken to the setup page at next sign-in.` },
    supers >= 2
      ? { id: "supers", level: "ok", title: "Super Admins", detail: `${supers} active Super Admins, so losing one account does not lock you out.` }
      : { id: "supers", level: "fail", title: "Super Admins", detail: `Only ${supers} active Super Admin. Keep at least two so a locked or lost account can be recovered.` },
    production
      ? { id: "prod", level: "ok", title: "Production mode", detail: "Secure cookies, HSTS and the strict content security policy are on." }
      : { id: "prod", level: "warn", title: "Production mode", detail: "Running in development mode. Secure cookies, HSTS and the strict content policy only apply in production." },
    process.env.STORAGE_DIR
      ? { id: "storage", level: "ok", title: "File storage location", detail: "STORAGE_DIR is set. Make sure that folder is backed up with the database." }
      : { id: "storage", level: "warn", title: "File storage location", detail: "STORAGE_DIR is not set, so uploaded files live inside the application folder. Point it at a backed-up location." },
    { id: "scan", level: "warn", title: "Virus scanning of uploads", detail: "Not configured. Uploads are checked by content type and size only; add a scanner before accepting files from the public." },
    staff.some((s) => s.mustChangePassword)
      ? { id: "pw", level: "warn", title: "Starting passwords", detail: `${staff.filter((s) => s.mustChangePassword).length} staff member${staff.filter((s) => s.mustChangePassword).length === 1 ? " has" : "s have"} not yet replaced a starting or reset password.` }
      : { id: "pw", level: "ok", title: "Starting passwords", detail: "Every active staff member has set their own password." },
  ];
  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-bold">Security checklist</h1>
      <p className="text-sm text-muted">Checked just now from the live system. Backups are verified with <code>npm run backup:check</code> because they live outside the application; see the <Link className="underline" href="/audit-logs">audit log</Link> for who did what.</p>
      <div className="card">
        <ul className="text-sm">
          {findings.map((f) => (
            <li key={f.id} className="flex gap-3 border-t border-border py-2 first:border-0">
              <span className={`w-12 shrink-0 font-semibold ${COLOR[f.level]}`}>{MARK[f.level]}</span>
              <span><strong>{f.title}.</strong> {f.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
