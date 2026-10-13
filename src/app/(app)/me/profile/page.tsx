import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Avatar, Notice, PageHeader, StatusBadge } from "@/components/ui";
import PhotoForm from "@/components/PhotoForm";

export const dynamic = "force-dynamic";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[10rem_1fr] gap-3 py-2 text-sm"><dt className="text-muted">{label}</dt><dd>{children || <span className="text-muted">Not set</span>}</dd></div>
);

export default async function MyProfile({ searchParams }: { searchParams: Promise<{ photoOk?: string; photoError?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [profile, photo] = await Promise.all([
    db.employeeProfile.findFirst({ where: { userId: user.id, organizationId: user.organizationId } }),
    db.storedFile.count({ where: { organizationId: user.organizationId, ownerType: "USER_PHOTO", ownerId: user.id, deletedAt: null } }),
  ]);
  const dept = profile?.departmentId ? await db.department.findUnique({ where: { id: profile.departmentId }, select: { name: true } }) : null;
  const fmt = (d: Date | null | undefined) => (d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);
  return (
    <div className="space-y-5">
      <PageHeader title="My profile" subtitle="Your details are kept by HR. You can add or change your picture here." />
      {sp.photoOk && <Notice kind="ok">{sp.photoOk}</Notice>}
      {sp.photoError && <Notice kind="error">{sp.photoError}</Notice>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="card space-y-4 text-center">
          <div className="flex justify-center"><Avatar name={user.name} userId={user.id} size={128} /></div>
          <div><h2 className="text-lg font-semibold">{user.name}</h2><p className="text-sm text-muted">{[profile?.designation, dept?.name].filter(Boolean).join(" · ") || user.roles.join(", ")}</p></div>
          {profile && <p className="text-xs text-muted">Employee ID <strong className="text-foreground">{profile.employeeNo}</strong></p>}
          <div className="flex justify-center"><PhotoForm userId={user.id} returnTo="/me/profile" hasPhoto={photo > 0} /></div>
        </section>
        <section className="card">
          <h2 className="mb-1 font-semibold">Personal and employment details</h2>
          <dl className="divide-y divide-border">
            <Row label="Full name">{user.name}</Row>
            <Row label="Sign-in email">{user.email}</Row>
            <Row label="Roles">{user.roles.join(", ")}</Row>
            {profile ? (
              <>
                <Row label="Phone">{profile.phone}</Row>
                <Row label="Emergency contact">{profile.emergencyContact}</Row>
                <Row label="Designation">{profile.designation}</Row>
                <Row label="Department">{dept?.name}</Row>
                <Row label="Employment type">{profile.employmentType.toLowerCase().replace("_", " ")}</Row>
                <Row label="Work location">{profile.workLocation.toLowerCase()}</Row>
                <Row label="Joining date">{fmt(profile.joinDate)}</Row>
                <Row label="Status"><StatusBadge status={profile.status} /></Row>
              </>
            ) : <p className="py-3 text-sm text-muted">HR has not created your employee profile yet.</p>}
          </dl>
        </section>
      </div>
    </div>
  );
}
