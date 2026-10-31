import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Avatar, Badge, Chips, Empty, Notice, PageHeader, PanelForm, StatusBadge } from "@/components/ui";
import { leaveBalances } from "@/lib/hr";
import { summarize } from "@/lib/monitoring";
import Drawer from "@/components/ui/Drawer";
import PhotoForm from "@/components/PhotoForm";
import { updateMyContactAction } from "./actions";

export const dynamic = "force-dynamic";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{children || <span className="text-muted">Not set</span>}</dd></div>
);
const EMPLOYMENT: Record<string, string> = { FULL_TIME: "Full time", PART_TIME: "Part time", CONTRACT: "Contract", INTERN: "Intern" };

export default async function MyProfile({ searchParams }: { searchParams: Promise<{ photoOk?: string; photoError?: string; edit?: string; error?: string; saved?: string; tab?: string }> }) {
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
  const has = (p: string) => user.permissions.has(p as never);
  const TABS: [string, string][] = [["overview", "Overview"], ["work", "Work"], ["time", "Time and leave"], ...(has("self.payslip") || has("commissions.own") ? [["pay", "Pay"] as [string, string]] : []), ["access", "Access"]];
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const today = new Date().toISOString().slice(0, 10);
  const full = await db.user.findUnique({ where: { id: user.id }, select: { phone: true, phoneVerifiedAt: true, emailVerifiedAt: true, totpEnabled: true, lastLoginAt: true, createdAt: true } });
  const tabHref = (k: string) => (k === "overview" ? "/me/profile" : `/me/profile?tab=${k}`);
  const work = tab === "work" ? await Promise.all([
    db.campaignMember.findMany({ where: { userId: user.id, campaign: { organizationId: org, archivedAt: null } }, include: { campaign: { select: { id: true, name: true, code: true, status: true } } } }),
    db.project.findMany({ where: { organizationId: org, status: { in: ["ACTIVE", "ON_HOLD"] }, OR: [{ managerId: user.id }, { members: { some: { userId: user.id } } }] }, select: { id: true, name: true, number: true, managerId: true, status: true }, orderBy: { number: "asc" } }),
    db.task.findMany({ where: { assigneeId: user.id, status: { not: "DONE" }, project: { organizationId: org, status: { not: "CANCELLED" } } }, include: { project: { select: { id: true, name: true } } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }], take: 8 }),
    db.user.findMany({ where: { organizationId: org, managerId: user.id, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]) : null;
  const time = tab === "time" ? await Promise.all([
    db.attendanceRecord.findMany({ where: { userId: user.id, workDate: { gte: `${today.slice(0, 7)}-01` } }, orderBy: { workDate: "desc" } }),
    leaveBalances(db, org, user.id, today.slice(0, 4)),
    db.leaveRequest.findMany({ where: { userId: user.id }, include: { leaveType: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
    has("monitoring.own") ? summarize(db, { organizationId: org, userIds: [user.id], from: today, to: today }) : Promise.resolve([]),
  ]) : null;
  const pay = tab === "pay" ? await Promise.all([
    has("self.payslip") ? db.payrollItem.findMany({ where: { userId: user.id, run: { status: { in: ["APPROVED", "POSTED", "PAID"] } } }, include: { run: true }, orderBy: { run: { period: "desc" } }, take: 6 }) : Promise.resolve([]),
    has("commissions.own") ? db.commissionEntry.groupBy({ by: ["status", "currency"], where: { organizationId: org, userId: user.id }, _sum: { amount: true }, _count: true }) : Promise.resolve([]),
  ]) : null;
  const sessions = tab === "access" ? await db.session.count({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } } }) : 0;
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

        <div className="min-w-0 space-y-6">
          <Chips current={tab} items={TABS.map(([k, l]) => ({ key: k, label: l, href: tabHref(k) }))} />
          {tab === "overview" && (<>
          <section className="card">
            <h2 className="mb-1 font-semibold">Personal and employment details</h2>
            {profile ? (
              <dl className="grid gap-x-8 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
                <div className="divide-y divide-border">
                  <Row label="Full name">{user.name}</Row>
                  <Row label="Official email">{user.email}{user.email && (full?.emailVerifiedAt ? <> <Badge tone="success">verified</Badge></> : <> <Badge tone="warning">not verified</Badge></>)}</Row>
                  <Row label="Contact number">{full?.phone}{full?.phone && (full.phoneVerifiedAt ? <> <Badge tone="success">verified</Badge></> : <> <Badge tone="warning">not verified</Badge></>)}</Row>
                  <Row label="Alternate contact">{profile.phone}</Row>
                  <Row label="Personal email">{profile.personalEmail}</Row>
                  <Row label="Home address">{profile.address}</Row>
                  <Row label="CNIC">{profile.identityNumber}</Row>
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
          </>)}

          {tab === "work" && work && (
            <>
              <section className="card space-y-2"><h2 className="font-semibold">My campaigns ({work[0].length})</h2>
                {work[0].length === 0 ? <p className="text-sm text-muted">You are not on a campaign team.</p> : <ul className="text-sm">{work[0].map((m) => <li key={m.campaignId} className="flex items-center justify-between border-t border-border py-1.5 first:border-0">{has("campaigns.view") ? <Link className="hover:underline" href={`/campaigns/${m.campaignId}`}>{m.campaign.name}</Link> : m.campaign.name}<span className="text-xs text-muted">{m.campaign.code} · <StatusBadge status={m.campaign.status} /></span></li>)}</ul>}
              </section>
              <section className="card space-y-2"><h2 className="font-semibold">My projects ({work[1].length})</h2>
                {work[1].length === 0 ? <p className="text-sm text-muted">No active projects.</p> : <ul className="text-sm">{work[1].map((p) => <li key={p.id} className="flex items-center justify-between border-t border-border py-1.5 first:border-0"><Link className="hover:underline" href={`/projects/${p.id}`}>{p.name}</Link><span className="text-xs text-muted">{p.number}{p.managerId === user.id && " · manager"}</span></li>)}</ul>}
              </section>
              <section className="card space-y-2"><div className="flex items-center justify-between"><h2 className="font-semibold">Open tasks</h2><Link href="/me/tasks" className="text-sm text-primary hover:underline">All my tasks</Link></div>
                {work[2].length === 0 ? <p className="text-sm text-muted">Nothing open. All caught up.</p> : <ul className="text-sm">{work[2].map((t) => <li key={t.id} className="flex items-center justify-between gap-3 border-t border-border py-1.5 first:border-0"><Link className="hover:underline" href={`/projects/${t.project.id}?task=${t.id}`}>{t.title}</Link><span className="shrink-0 text-xs text-muted">{t.project.name}{t.dueDate && ` · due ${t.dueDate.toLocaleDateString()}`}</span></li>)}</ul>}
              </section>
              {work[3].length > 0 && <section className="card space-y-2"><h2 className="font-semibold">People who report to me ({work[3].length})</h2><ul className="flex flex-wrap gap-2 text-sm">{work[3].map((r) => <li key={r.id} className="rounded-full border border-border px-3 py-1">{r.name}</li>)}</ul></section>}
            </>
          )}

          {tab === "time" && time && (
            <>
              <section className="card space-y-2"><div className="flex items-center justify-between"><h2 className="font-semibold">Attendance this month</h2><Link href="/me/attendance" className="text-sm text-primary hover:underline">Open attendance</Link></div>
                {(() => { const t = time[0].find((r) => r.workDate === today); return <p className="text-sm">{t ? `Today: in at ${t.clockIn.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${t.clockOut ? `, out at ${t.clockOut.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ", still working"}.` : "Not clocked in today."} {time[0].length} day{time[0].length === 1 ? "" : "s"} recorded this month.</p>; })()}
                {time[3].length > 0 && <p className="text-xs text-muted">Workfolio today: {time[3][0].activeMinutes} min active, {time[3][0].idleMinutes} min idle. <Link className="underline" href="/me/time">See everything recorded about you</Link>.</p>}
              </section>
              <section className="card !p-0"><div className="flex items-center justify-between border-b border-border px-5 py-3"><h2 className="font-semibold">Leave balances, {today.slice(0, 4)}</h2><Link href="/me/leave" className="text-sm text-primary hover:underline">Request leave</Link></div>
                {time[1].length === 0 ? <p className="px-5 py-4 text-sm text-muted">No leave types set up.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-5 py-2.5">Type</th><th className="pr-4 text-right">Allowance</th><th className="pr-4 text-right">Taken</th><th className="pr-4 text-right">Pending</th><th className="pr-5 text-right">Left</th></tr></thead><tbody>{time[1].map((b) => <tr key={b.type.id} className="border-t border-border"><td className="px-5 py-2">{b.type.name}</td><td className="pr-4 text-right tabular-nums">{b.allowance}</td><td className="pr-4 text-right tabular-nums">{b.approved}</td><td className="pr-4 text-right tabular-nums">{b.pending}</td><td className="pr-5 text-right font-medium tabular-nums">{b.type.paid ? b.remaining : "n/a"}</td></tr>)}</tbody></table></div>}
              </section>
              <section className="card space-y-2"><h2 className="font-semibold">Recent leave requests</h2>
                {time[2].length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="text-sm">{time[2].map((l) => <li key={l.id} className="flex items-center justify-between border-t border-border py-1.5 first:border-0"><span>{l.leaveType.name}, {l.startDate} to {l.endDate} ({String(l.days)} d)</span><StatusBadge status={l.status} /></li>)}</ul>}
              </section>
            </>
          )}

          {tab === "pay" && pay && (
            <>
              {has("self.payslip") && <section className="card space-y-2"><div className="flex items-center justify-between"><h2 className="font-semibold">Payslips</h2><Link href="/me/payslips" className="text-sm text-primary hover:underline">All payslips</Link></div>
                {pay[0].length === 0 ? <p className="text-sm text-muted">No payslips yet.</p> : <ul className="text-sm">{pay[0].map((i) => <li key={i.id} className="flex items-center justify-between border-t border-border py-1.5 first:border-0"><Link className="underline" href={`/payslips/${i.id}`}>{i.run.period}</Link><span>{formatMoney(i.net, i.run.currency)} net · {i.run.status.toLowerCase()}</span></li>)}</ul>}
              </section>}
              {has("commissions.own") && <section className="card space-y-2"><div className="flex items-center justify-between"><h2 className="font-semibold">Commissions and bonuses</h2><Link href="/me/commissions" className="text-sm text-primary hover:underline">My statement</Link></div>
                {pay[1].length === 0 ? <p className="text-sm text-muted">Nothing earned yet.</p> : <ul className="text-sm">{pay[1].map((g) => <li key={`${g.status}${g.currency}`} className="flex items-center justify-between border-t border-border py-1.5 first:border-0"><span>{g.status.toLowerCase()} ({g._count})</span><span>{formatMoney(g._sum.amount ?? 0, g.currency)}</span></li>)}</ul>}
              </section>}
              <p className="text-xs text-muted">Salary structure and bank details are held by HR and Finance. Ask them if something looks wrong.</p>
            </>
          )}

          {tab === "access" && (
            <>
              <section className="card space-y-2 text-sm"><h2 className="font-semibold">Sign-in and security</h2>
                <dl className="divide-y divide-border">
                  <Row label="Sign in with">{[user.email, full?.phone].filter(Boolean).join(" or ")}</Row>
                  <Row label="Two-step check">{full?.totpEnabled ? <Badge tone="success">on</Badge> : <><Badge tone="warning">off</Badge> <Link className="underline" href="/account/security">Turn it on</Link></>}</Row>
                  <Row label="Last sign-in">{full?.lastLoginAt?.toLocaleString()}</Row>
                  <Row label="Active sessions">{String(sessions)}</Row>
                  <Row label="Account created">{fmt(full?.createdAt)}</Row>
                </dl>
                <div className="flex flex-wrap gap-2 pt-1"><Link href="/account/password" className="btn-ghost">Change password</Link><Link href="/account/security" className="btn-ghost">Security</Link></div>
              </section>
              <section className="card space-y-2 text-sm"><h2 className="font-semibold">My roles</h2>
                <div className="flex flex-wrap gap-2">{user.roles.map((r) => <Badge key={r} tone="primary">{r}</Badge>)}</div>
                <p className="text-xs text-muted">You hold {user.permissions.size} permission{user.permissions.size === 1 ? "" : "s"} through these roles. Ask an administrator if you need something you cannot open.</p>
              </section>
            </>
          )}
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
