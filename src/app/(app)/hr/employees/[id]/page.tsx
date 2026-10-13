import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import FilesPanel from "@/components/FilesPanel";
import PhotoForm from "@/components/PhotoForm";
import Avatar from "@/components/ui/Avatar";

export const dynamic = "force-dynamic";

const opt = z.string().trim().max(300).optional().transform((v) => (v ? v : null));
const schema = z.object({
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date of birth").or(z.literal("")).transform((v) => (v ? v : null)),
  gender: z.enum(["Male", "Female", "Other", ""]).transform((v) => (v ? v : null)), fatherName: opt,
  designation: opt, phone: opt, personalEmail: opt, address: opt, emergencyContact: opt,
  workLocation: z.enum(["OFFICE", "REMOTE", "HYBRID", "FIELD"]),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]),
  status: z.enum(["ACTIVE", "EXITED"]),
  identityNumber: opt, bankDetails: opt,
});

async function save(formData: FormData) {
  "use server";
  const user = await requirePermission("hr.manage");
  const id = String(formData.get("id"));
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const before = await db.employeeProfile.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!before) return;
  const sensitive = user.permissions.has("hr.view_sensitive");
  const { identityNumber, bankDetails, ...rest } = parsed.data;
  const after = await db.employeeProfile.update({
    where: { id },
    data: {
      ...rest,
      // Without the sensitive permission these fields are untouched, never blanked
      ...(sensitive ? { identityNumber, bankDetails } : {}),
      exitDate: rest.status === "EXITED" ? before.exitDate ?? new Date() : null,
    },
  });
  // Audit records which fields changed, never the sensitive values themselves
  const changed = Object.keys(rest).filter((k) => (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]);
  const sensitiveChanged = sensitive && (before.identityNumber !== after.identityNumber || before.bankDetails !== after.bankDetails);
  await audit(user, { action: "employee.update", entity: "EmployeeProfile", entityId: id, after: { changed, sensitiveChanged } });
  revalidatePath(`/hr/employees/${id}`);
}

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fileError?: string; fileOk?: string }> }) {
  const user = await requirePermission("hr.view");
  const { id } = await params;
  const { fileError, fileOk } = await searchParams;
  const p = await db.employeeProfile.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!p) notFound();
  const u = await db.user.findUnique({ where: { id: p.userId }, include: { roles: { include: { role: true } } } });
  const photoCount = await db.storedFile.count({ where: { organizationId: user.organizationId, ownerType: "USER_PHOTO", ownerId: p.userId, deletedAt: null } });
  const canManage = user.permissions.has("hr.manage");
  const sensitive = user.permissions.has("hr.view_sensitive");
  const f = (name: string, label: string, value: string | null) => (
    <div key={name}><label className="label" htmlFor={name}>{label}</label><input id={name} name={name} defaultValue={value ?? ""} disabled={!canManage} className="input" /></div>
  );
  return (
    <div className="space-y-4">
      <Link href="/hr/employees" className="text-sm text-muted hover:underline">← All employees</Link>
      <div className="flex flex-wrap items-center gap-4"><Avatar name={u?.name ?? "?"} userId={p.userId} size={72} /><h1 className="text-2xl font-semibold tracking-tight">{u?.name} <span className="text-muted text-base font-normal">{p.employeeNo}</span></h1></div>
      {canManage && <PhotoForm userId={p.userId} returnTo={`/hr/employees/${p.id}`} hasPhoto={photoCount > 0} />}
      <p className="text-sm text-muted">{u?.email} · {u?.roles.map((r) => r.role.name).join(", ")}{p.joinDate && ` · Joined ${p.joinDate.toLocaleDateString()}`}</p>
      <form action={save} className="card grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={p.id} />
        {f("designation", "Designation", p.designation)}
        <div><label className="label" htmlFor="dateOfBirth">Date of birth</label><input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={p.dateOfBirth ?? ""} disabled={!canManage} className="input" /></div>
        <div><label className="label" htmlFor="gender">Gender</label><select id="gender" name="gender" defaultValue={p.gender ?? ""} disabled={!canManage} className="input"><option value="">Not set</option><option>Male</option><option>Female</option><option>Other</option></select></div>
        {f("fatherName", "Father's name", p.fatherName)}
        {f("phone", "Phone", p.phone)}
        {f("personalEmail", "Personal email", p.personalEmail)}
        {f("emergencyContact", "Emergency contact", p.emergencyContact)}
        <div className="sm:col-span-2">{f("address", "Address", p.address)}</div>
        <div><label className="label" htmlFor="workLocation">Work location</label>
          <select id="workLocation" name="workLocation" defaultValue={p.workLocation} disabled={!canManage} className="input">{["OFFICE", "REMOTE", "HYBRID", "FIELD"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className="label" htmlFor="employmentType">Employment type</label>
          <select id="employmentType" name="employmentType" defaultValue={p.employmentType} disabled={!canManage} className="input">{["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={p.status} disabled={!canManage} className="input"><option>ACTIVE</option><option>EXITED</option></select></div>
        {sensitive ? (
          <>
            {f("identityNumber", "Identity document number (restricted)", p.identityNumber)}
            {f("bankDetails", "Bank / payment details (restricted)", p.bankDetails)}
          </>
        ) : (
          <p className="sm:col-span-2 text-sm text-muted">Identity and bank details are restricted to authorized HR users.</p>
        )}
        {canManage && <div className="sm:col-span-2"><button className="btn">Save changes</button></div>}
      </form>
      {sensitive && <FilesPanel user={user} ownerType="EMPLOYEE" ownerId={p.userId} returnTo={`/hr/employees/${p.id}`} title="Employee documents" withCategory withExpiry flash={{ fileError, fileOk }} />}
    </div>
  );
}
