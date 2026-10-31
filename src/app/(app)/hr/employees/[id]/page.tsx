import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import FilesPanel from "@/components/FilesPanel";
import PhotoForm from "@/components/PhotoForm";
import { Badge, ConfirmButton, Notice, StatusBadge, SubmitButton } from "@/components/ui";
import Avatar from "@/components/ui/Avatar";
import StaffForm from "../StaffForm";
import SetupLink from "./SetupLink";
import { staffStatusAction } from "../actions";

export const dynamic = "force-dynamic";

const opt = z.string().trim().max(300).optional().transform((v) => (v ? v : null));
const schema = z.object({
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date of birth").or(z.literal("")).transform((v) => (v ? v : null)),
  gender: z.enum(["Male", "Female", "Other", ""]).transform((v) => (v ? v : null)), fatherName: opt,
  personalEmail: opt, address: opt, emergencyContact: opt,
  workLocation: z.enum(["OFFICE", "REMOTE", "HYBRID", "FIELD"]),
  bankDetails: opt,
});

// Personal HR details that are not part of the directory record
async function saveDetails(formData: FormData) {
  "use server";
  const user = await requirePermission("hr.manage");
  const id = String(formData.get("id"));
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const before = await db.employeeProfile.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!before) return;
  const sensitive = user.permissions.has("hr.view_sensitive");
  const { bankDetails, ...rest } = parsed.data;
  const after = await db.employeeProfile.update({ where: { id }, data: { ...rest, ...(sensitive ? { bankDetails } : {}) } });
  const changed = Object.keys(rest).filter((k) => (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]);
  await audit(user, { action: "employee.update", entity: "EmployeeProfile", entityId: id, after: { changed, sensitiveChanged: sensitive && before.bankDetails !== after.bankDetails } });
  revalidatePath(`/hr/employees/${id}`);
}

const Verified = ({ at }: { at: Date | null }) => (at ? <Badge tone="success">verified</Badge> : <Badge tone="warning">not verified</Badge>);

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fileError?: string; fileOk?: string; error?: string; msg?: string }> }) {
  const user = await requirePermission("hr.view");
  const { id } = await params;
  const sp = await searchParams;
  const org = user.organizationId;
  const p = await db.employeeProfile.findFirst({ where: { id, organizationId: org }, include: { user: { include: { roles: { include: { role: true } }, manager: { select: { name: true } }, department: { select: { name: true } } } } } });
  if (!p) notFound();
  const u = p.user;
  const canManage = user.permissions.has("hr.manage");
  const sensitive = user.permissions.has("hr.view_sensitive");
  const canAccess = user.permissions.has("users.manage");
  const [photoCount, campaigns, projects, departments, managers] = await Promise.all([
    db.storedFile.count({ where: { organizationId: org, ownerType: "USER_PHOTO", ownerId: p.userId, deletedAt: null } }),
    db.campaignMember.findMany({ where: { userId: p.userId, campaign: { organizationId: org } }, include: { campaign: { select: { id: true, name: true, code: true, status: true, archivedAt: true } } } }),
    db.project.findMany({ where: { organizationId: org, OR: [{ managerId: p.userId }, { members: { some: { userId: p.userId } } }] }, select: { id: true, name: true, number: true, status: true, managerId: true }, orderBy: { number: "asc" } }),
    canManage ? db.department.findMany({ where: { organizationId: org }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    canManage ? db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const op = (value: string) => <><input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value={value} /></>;
  return (
    <div className="space-y-5">
      <Link href="/hr/employees" className="text-sm text-muted hover:underline">← Staff directory</Link>
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={u.name} userId={p.userId} size={72} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{u.name} <span className="text-base font-normal text-muted">{p.employeeNo}</span></h1>
          <p className="text-sm text-muted">{p.designation ?? "No designation"}{u.department && ` · ${u.department.name}`}{u.manager && ` · reports to ${u.manager.name}`}{p.joinDate && ` · joined ${p.joinDate.toISOString().slice(0, 10)}`}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{p.archivedAt ? <StatusBadge status="ARCHIVED" /> : <StatusBadge status={p.status} />}{!u.active && <Badge tone="danger">cannot sign in</Badge>}</div>
        </div>
      </div>
      {canManage && <PhotoForm userId={p.userId} returnTo={`/hr/employees/${p.id}`} hasPhoto={photoCount > 0} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold">Sign-in and contact</h2>
          <p>Official email: {u.email ?? <span className="text-muted">not recorded</span>} {u.email && <Verified at={u.emailVerifiedAt} />}</p>
          <p>Contact number: {u.phone ?? <span className="text-muted">not recorded</span>} {u.phone && <Verified at={u.phoneVerifiedAt} />}</p>
          <p>Alternate contact: {p.phone ?? <span className="text-muted">not recorded</span>}</p>
          {sensitive && <p>CNIC: {p.identityNumber ?? <span className="text-muted">not recorded</span>}</p>}
          {canManage && (
            <div className="flex flex-wrap gap-2 pt-1">
              {u.email && !u.emailVerifiedAt && <form action={staffStatusAction}>{op("verify_email")}<SubmitButton className="btn-ghost !py-1">Mark email verified</SubmitButton></form>}
              {u.phone && !u.phoneVerifiedAt && <form action={staffStatusAction}>{op("verify_phone")}<SubmitButton className="btn-ghost !py-1">Mark number verified</SubmitButton></form>}
            </div>
          )}
          <p className="text-xs text-muted">No SMS provider is configured, so numbers are verified by an administrator, not by a text message.</p>
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold">Access</h2>
          <p>{u.roles.map((r) => r.role.name).join(", ") || "No roles"}</p>
          {canAccess ? <Link href={`/users/${u.id}`} className="text-primary underline">Change roles and permissions</Link> : <p className="text-xs text-muted">Roles are changed by someone who manages user access.</p>}
          {canAccess && !p.archivedAt && u.active && <SetupLink userId={u.id} />}
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold">Assignments</h2>
          <p className="text-xs font-medium text-muted">Campaigns</p>
          {campaigns.length === 0 ? <p className="text-muted">None</p> : <ul>{campaigns.map((c) => <li key={c.campaignId}><Link className="hover:underline" href={`/campaigns/${c.campaign.id}`}>{c.campaign.name}</Link> <span className="text-xs text-muted">{c.campaign.code}{c.role && ` · ${c.role}`}{c.campaign.archivedAt && " · archived"}</span></li>)}</ul>}
          <p className="pt-1 text-xs font-medium text-muted">Projects</p>
          {projects.length === 0 ? <p className="text-muted">None</p> : <ul>{projects.map((x) => <li key={x.id}><Link className="hover:underline" href={`/projects/${x.id}`}>{x.name}</Link> <span className="text-xs text-muted">{x.number}{x.managerId === p.userId && " · manager"}</span></li>)}</ul>}
        </section>
      </div>

      {canManage ? (
        <StaffForm mode="edit" departments={departments} managers={managers} canSensitive={sensitive} closeTo={`/hr/employees/${p.id}`}
          values={{ id: p.id, name: u.name, email: u.email ?? "", phone: u.phone ?? "", alternatePhone: p.phone ?? "", designation: p.designation ?? "", departmentId: u.departmentId ?? p.departmentId ?? "", employmentType: p.employmentType, joinDate: p.joinDate?.toISOString().slice(0, 10) ?? "", managerId: u.managerId ?? "", notes: p.notes ?? "", identityNumber: sensitive ? p.identityNumber ?? "" : "" }} />
      ) : (
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Record</h2><p>Employment type: {p.employmentType.replace("_", " ").toLowerCase()}</p>{p.notes && <p className="mt-2 whitespace-pre-wrap">{p.notes}</p>}</section>
      )}

      <form action={saveDetails} className="card grid gap-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Personal details</h2>
        <input type="hidden" name="id" value={p.id} />
        <div><label className="label" htmlFor="dateOfBirth">Date of birth</label><input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={p.dateOfBirth ?? ""} disabled={!canManage} className="input" /></div>
        <div><label className="label" htmlFor="gender">Gender</label><select id="gender" name="gender" defaultValue={p.gender ?? ""} disabled={!canManage} className="input"><option value="">Not set</option><option>Male</option><option>Female</option><option>Other</option></select></div>
        <div><label className="label" htmlFor="fatherName">Father&apos;s name</label><input id="fatherName" name="fatherName" defaultValue={p.fatherName ?? ""} disabled={!canManage} className="input" /></div>
        <div><label className="label" htmlFor="personalEmail">Personal email</label><input id="personalEmail" name="personalEmail" defaultValue={p.personalEmail ?? ""} disabled={!canManage} className="input" /></div>
        <div><label className="label" htmlFor="emergencyContact">Emergency contact</label><input id="emergencyContact" name="emergencyContact" defaultValue={p.emergencyContact ?? ""} disabled={!canManage} className="input" /></div>
        <div><label className="label" htmlFor="workLocation">Work location</label><select id="workLocation" name="workLocation" defaultValue={p.workLocation} disabled={!canManage} className="input">{["OFFICE", "REMOTE", "HYBRID", "FIELD"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="address">Address</label><input id="address" name="address" defaultValue={p.address ?? ""} disabled={!canManage} className="input" /></div>
        {sensitive && <div className="sm:col-span-2"><label className="label" htmlFor="bankDetails">Bank / payment details (restricted)</label><input id="bankDetails" name="bankDetails" defaultValue={p.bankDetails ?? ""} disabled={!canManage} className="input" /></div>}
        {canManage && <div className="sm:col-span-2"><SubmitButton>Save personal details</SubmitButton></div>}
      </form>

      {canManage && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Status</h2>
          <p className="text-sm text-muted">Deactivating stops sign-in at once. Nothing is deleted: attendance, tasks, payroll and history stay with the person.</p>
          <div className="flex flex-wrap gap-2">
            {p.archivedAt ? (
              <form action={staffStatusAction}>{op("restore")}<ConfirmButton title="Restore this record?" message="It returns to the directory as inactive. Reactivate it to allow sign-in." confirmLabel="Restore">Restore from archive</ConfirmButton></form>
            ) : (
              <>
                {p.status !== "ACTIVE" && <form action={staffStatusAction}>{op("ACTIVE")}<ConfirmButton title={`Reactivate ${u.name}?`} message="They can sign in again with their existing password." confirmLabel="Reactivate">Reactivate</ConfirmButton></form>}
                {p.status === "ACTIVE" && <form action={staffStatusAction}>{op("INACTIVE")}<ConfirmButton title={`Deactivate ${u.name}?`} message="They are signed out everywhere and cannot sign in until reactivated." confirmLabel="Deactivate">Deactivate</ConfirmButton></form>}
                {p.status !== "EXITED" && <form action={staffStatusAction}>{op("EXITED")}<ConfirmButton title={`Mark ${u.name} as exited?`} message="Use this when the person has left. Sign-in stops; the exit date is recorded." confirmLabel="Mark exited">Mark as exited</ConfirmButton></form>}
                <form action={staffStatusAction}>{op("archive")}<ConfirmButton title="Archive this record?" message="It leaves the directory and sign-in stops. History is kept and the record can be restored." confirmLabel="Archive">Archive</ConfirmButton></form>
              </>
            )}
          </div>
        </section>
      )}
      {sensitive && <FilesPanel user={user} ownerType="EMPLOYEE" ownerId={p.userId} returnTo={`/hr/employees/${p.id}`} title="Employee documents" withCategory withExpiry flash={{ fileError: sp.fileError, fileOk: sp.fileOk }} />}
    </div>
  );
}
