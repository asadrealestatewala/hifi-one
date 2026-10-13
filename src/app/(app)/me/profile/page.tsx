import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Avatar, Badge, Empty, Notice, PageHeader, PanelForm, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import PhotoForm from "@/components/PhotoForm";
import { updateMyContactAction } from "./actions";

export const dynamic = "force-dynamic";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{children || <span className="text-muted">Not set</span>}</dd></div>
);
const EMPLOYMENT: Record<string, string> = { FULL_TIME: "Full time", PART_TIME: "Part time", CONTRACT: "Contract", INTERN: "Intern" };

export default async function MyProfile({ searchParams }: { searchParams: Promise<{ photoOk?: string; photoError?: string; edit?: string; error?: string; saved?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const org = user.organizationId;
  const [profile, photo, me] = await Promise.all([
    db.employeeProfile.findFirst({ where: { userId: user.id, organizationId: org } }),
    db.storedFile.count({ where: { organizationId: org, ownerType: "USER_PHOTO", ownerId: user.id, deletedAt: null } }),
    db.user.findUnique({ where: { id: user.id }, select: { branchId: true, departmentId: true, managerId: true } }),
  ]);
  const deptId = profile?.departmentId ?? me?.departmentId ?? null;
  const [dept, branch, manager, assets] = await Promise.all([
    deptId ? db.department.findUnique({ where: { id: deptId }, select: { name: true } }) : null,
    me?.branchId ? db.branch.findUnique({ where: { id: me.branchId }, select: { name: true } }) : null,
    me?.managerId ? db.user.findUnique({ where: { id: me.managerId }, select: { id: true, name: true } }) : null,
    db.asset.findMany({ where: { organizationId: org, assignedToId: user.id, status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);
  const fmt = (v: string | Date | null | undefined) => (v ? new Date(typeof v === "string" ? v + "T00:00:00" : v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);
  const closeTo = "/me/profile";
  return (
    <div className="space-y-5">
      <PageHeader title="My profile" subtitle="Your details are maintained by HR. You can update your contact numbers and your picture." actions={profile ? <Link href="/me/profile?edit=1" className="btn-ghost">Update contact details</Link> : undefined} />
      {sp.photoOk && <Notice kind="ok">{sp.photoOk}</Notice>}
      {sp.saved && <Notice kind="ok">Your contact details were updated.</Notice>}
      {sp.photoError && <Notice kind="error">{sp.photoError}</Notice>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="card space-y-3 text-center">
          <div className="flex justify-center"><Avatar name={user.name} userId={user.id} size={128} /></div>
          <div><h2 className="text-lg font-semibold">{user.name}</h2><p className="text-sm text-muted">{[profile?.designation, dept?.name].filter(Boolean).join(" · ") || user.roles.join(", ")}</p></div>
          {profile && <div className="flex justify-center gap-2"><Badge tone="success">{EMPLOYMENT[profile.employmentType] ?? profile.employmentType}</Badge><StatusBadge status={profile.status} /></div>}
          {profile && <p className="text-xs text-muted">Employee ID <strong className="text-foreground">{profile.employeeNo}</strong></p>}
          <div className="flex justify-center"><PhotoForm userId={user.id} returnTo={closeTo} hasPhoto={photo > 0} /></div>
        </section>

        <div className="space-y-6">
          <section className="card">
            <h2 className="mb-1 font-semibold">Personal and employment details</h2>
            {profile ? (
              <dl className="grid gap-x-8 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
                <div className="divide-y divide-border">
                  <Row label="Full name">{user.name}</Row>
                  <Row label="Email">{user.email}</Row>
                  <Row label="Phone">{profile.phone}</Row>
                  <Row label="Emergency contact">{profile.emergencyContact}</Row>
                  <Row label="Date of birth">{fmt(profile.dateOfBirth)}</Row>
                  <Row label="Gender">{profile.gender}</Row>
                  <Row label="Father&apos;s name">{profile.fatherName}</Row>
                </div>
                <div className="divide-y divide-border">
                  <Row label="Employee ID">{profile.employeeNo}</Row>
                  <Row label="Joining date">{fmt(profile.joinDate)}</Row>
                  <Row label="Employment">{EMPLOYMENT[profile.employmentType]}</Row>
                  <Row label="Department">{dept?.name}</Row>
                  <Row label="Designation">{profile.designation}</Row>
                  <Row label="Branch">{branch?.name}</Row>
                  <Row label="Reports to">{manager?.name}</Row>
                  <Row label="Work location">{profile.workLocation.toLowerCase()}</Row>
                  <Row label="Account status"><StatusBadge status={profile.status} /></Row>
                </div>
              </dl>
            ) : <p className="py-3 text-sm text-muted">HR has not created your employee profile yet.</p>}
          </section>

          <section className="card !p-0">
            <h2 className="border-b border-border px-5 py-3 font-semibold">Company assets ({assets.length})</h2>
            {assets.length === 0 ? <div className="px-5 py-8"><Empty title="Nothing assigned">No company assets are assigned to you.</Empty></div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-5 py-2.5">Asset</th><th className="pr-4">Number</th><th className="pr-4">Serial</th><th className="pr-4">Location</th><th className="pr-4 text-right">Cost</th></tr></thead>
                <tbody>{assets.map((a) => <tr key={a.id} className="border-t border-border"><td className="px-5 py-2.5 font-medium">{a.name}</td><td className="pr-4 text-muted">{a.number}</td><td className="pr-4 text-muted">{a.serialNumber}</td><td className="pr-4 text-muted">{a.location}</td><td className="pr-4 text-right tabular-nums">{formatMoney(a.cost, a.currency)}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </div>
      </div>

      {sp.edit && profile && (
        <Drawer title="Update contact details" closeTo={closeTo}>
          <PanelForm action={updateMyContactAction} closeTo={closeTo} submit="Save" error={sp.error} hint="Only HR can change your name, role and employment details.">
            <div className="grid gap-3">
              <div><label className="label" htmlFor="mc-phone">Phone</label><input id="mc-phone" name="phone" defaultValue={profile.phone ?? ""} maxLength={40} inputMode="tel" className="input" /></div>
              <div><label className="label" htmlFor="mc-em">Emergency contact (name and number)</label><input id="mc-em" name="emergencyContact" defaultValue={profile.emergencyContact ?? ""} maxLength={200} className="input" /></div>
              <div><label className="label" htmlFor="mc-pe">Personal email</label><input id="mc-pe" name="personalEmail" type="email" defaultValue={profile.personalEmail ?? ""} maxLength={200} className="input" /></div>
              <div><label className="label" htmlFor="mc-ad">Home address</label><textarea id="mc-ad" name="address" rows={3} defaultValue={profile.address ?? ""} maxLength={300} className="input" /></div>
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
