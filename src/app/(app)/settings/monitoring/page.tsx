import { requirePermission } from "@/lib/auth";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { getPolicy } from "@/lib/monitoring";
import { categoryAction, purgeAction, revokeAction, savePolicyAction } from "./actions";
import EnrollForm from "./EnrollForm";

export const dynamic = "force-dynamic";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STARTER = `Hifi Marketing and Technologies records work time so that attendance, workload and project time can be understood and paid correctly.

What we record: when you clock in and out, your breaks, how many seconds you were active or idle, and how many key presses and clicks happened. We never record what you type, passwords, messages, window titles or web addresses. If the desktop app is installed, we also record the names of applications you use and, if enabled below, screenshots at the interval shown.

When: only during your working hours and never while you are on a break.

Who can see it: you can see everything recorded about you. HR can see reports. Only people with explicit permission can open screenshots, and every time they do it is logged and visible to you.

How long: screenshots are deleted after the retention period; activity totals after 180 days.

Your rights: you can ask for a day to be corrected and you can flag any screenshot for review. This information is context for conversations about workload; it is not used on its own to judge performance.`;

export default async function MonitoringSettings({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("monitoring.configure");
  const sp = await searchParams;
  const org = user.organizationId;
  const policy = await getPolicy(db, org);
  const [devices, categories, people, accepted, totalStaff, shotStats] = await Promise.all([
    db.monitorDevice.findMany({ where: { organizationId: org }, orderBy: { enrolledAt: "desc" }, take: 100 }),
    db.appCategory.findMany({ where: { organizationId: org }, orderBy: { pattern: "asc" } }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.policyAck.count({ where: { version: policy.version, userId: { in: (await db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, select: { id: true } })).map((u) => u.id) } } }),
    db.user.count({ where: { organizationId: org, userType: "EMPLOYEE", active: true } }),
    db.screenshot.aggregate({ where: { organizationId: org, deletedAt: null }, _count: true, _sum: { size: true } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const days = new Set(policy.workDays.split(","));
  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="Monitoring policy and devices" subtitle="Time and activity tracking is off until you write the policy people will read and turn it on. Changing what is collected asks everyone to accept the new version first."
        actions={<Badge tone={policy.enabled ? "success" : "neutral"}>{policy.enabled ? `On · version ${policy.version}` : "Off"}</Badge>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}

      <form action={savePolicyAction} className="card space-y-5">
        <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={policy.enabled} className="h-4 w-4" /> Monitoring is on</label>
        <div>
          <label className="label" htmlFor="policyText">The policy employees will read and accept</label>
          <textarea id="policyText" name="policyText" rows={12} defaultValue={policy.policyText || STARTER} className="input font-sans text-sm leading-relaxed" />
          <p className="mt-1 text-xs text-muted">Edit this to match your real practice and local law before turning monitoring on. It must say what is collected, when, who can see it, how long it is kept, and how to dispute it.</p>
        </div>
        <fieldset className="grid gap-3 sm:grid-cols-3 text-sm">
          <legend className="label">What is collected</legend>
          <label className="flex items-start gap-2"><input type="checkbox" name="trackActivity" defaultChecked={policy.trackActivity} className="mt-1" /> Active and idle time, key and click counts</label>
          <label className="flex items-start gap-2"><input type="checkbox" name="trackApps" defaultChecked={policy.trackApps} className="mt-1" /> Application names (desktop app only)</label>
          <label className="flex items-start gap-2"><input type="checkbox" name="screenshots" defaultChecked={policy.screenshots} className="mt-1" /> Screenshots (desktop app only)</label>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label className="label" htmlFor="screenshotIntervalMin">Screenshot every (minutes)</label><input id="screenshotIntervalMin" name="screenshotIntervalMin" type="number" min={5} max={120} defaultValue={policy.screenshotIntervalMin} className="input" /></div>
          <div><label className="label" htmlFor="idleThresholdMin">Idle after (minutes)</label><input id="idleThresholdMin" name="idleThresholdMin" type="number" min={1} max={30} defaultValue={policy.idleThresholdMin} className="input" /></div>
          <div><label className="label" htmlFor="retentionDays">Keep screenshots (days)</label><input id="retentionDays" name="retentionDays" type="number" min={1} max={365} defaultValue={policy.retentionDays} className="input" /></div>
          <div><label className="label" htmlFor="timezone">Time zone</label><input id="timezone" name="timezone" defaultValue={policy.timezone} className="input" /></div>
          <div><label className="label" htmlFor="workStart">Working hours from</label><input id="workStart" name="workStart" type="time" defaultValue={policy.workStart} className="input" /></div>
          <div><label className="label" htmlFor="workEnd">to</label><input id="workEnd" name="workEnd" type="time" defaultValue={policy.workEnd} className="input" /></div>
          <fieldset className="sm:col-span-2"><legend className="label">Working days</legend><div className="flex flex-wrap gap-3 text-sm">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="workDays" value={i} defaultChecked={days.has(String(i))} /> {d}</label>)}</div></fieldset>
        </div>
        <button className="btn">Save policy</button>
      </form>

      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">Acceptance</h2>
        <p>{accepted} of {totalStaff} active staff have accepted version {policy.version}. People who have not accepted are not recorded at all.</p>
        <p className="text-muted">Screenshots held: {shotStats._count} ({((shotStats._sum.size ?? 0) / 1048576).toFixed(1)} MB). <form action={purgeAction} className="inline"><button className="underline">Remove everything past its retention now</button></form></p>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">Desktop app devices</h2>
        <p className="text-sm text-muted">The browser tracker only sees the Hifi One tab. For application usage and screenshots, staff install the desktop app, which shows its status on screen the whole time. Create a one-time code for a person, they enter it in the app, and the device appears below. See docs/MONITORING.md.</p>
        <EnrollForm people={people} />
        {devices.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left"><tr><th className="py-2 pr-4">Device</th><th className="pr-4">Person</th><th className="pr-4">Last seen</th><th className="pr-4">Status</th><th></th></tr></thead>
            <tbody>{devices.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="py-2 pr-4">{d.name}<span className="block text-xs text-muted">{d.os} {d.agentVersion && `· v${d.agentVersion}`}</span></td><td className="pr-4">{name.get(d.userId) ?? "Former staff"}</td>
                <td className="pr-4">{d.lastSeenAt ? d.lastSeenAt.toLocaleString() : "never"}</td><td className="pr-4">{d.revokedAt ? <Badge tone="danger">revoked</Badge> : <Badge tone="success">active</Badge>}</td>
                <td>{!d.revokedAt && <form action={revokeAction}><input type="hidden" name="id" value={d.id} /><button className="underline text-xs">Revoke</button></form>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Application categories</h2>
        <p className="text-sm text-muted">Optional labels so reports can group applications. Matched against the application name.</p>
        <ul className="text-sm">{categories.map((c) => <li key={c.id} className="flex items-center justify-between border-t border-border py-1.5 first:border-0"><span>{c.pattern} <Badge tone={c.category === "PRODUCTIVE" ? "success" : c.category === "UNPRODUCTIVE" ? "warning" : "neutral"}>{c.category.toLowerCase()}</Badge></span><form action={categoryAction}><input type="hidden" name="op" value="delete" /><input type="hidden" name="id" value={c.id} /><button className="underline text-xs">Remove</button></form></li>)}</ul>
        <form action={categoryAction} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <input type="hidden" name="op" value="add" />
          <div><label className="label" htmlFor="pattern">Application name contains</label><input id="pattern" name="pattern" required maxLength={60} className="input !w-56" placeholder="e.g. photoshop" /></div>
          <div><label className="label" htmlFor="category">Category</label><select id="category" name="category" className="input"><option>PRODUCTIVE</option><option>NEUTRAL</option><option>UNPRODUCTIVE</option></select></div>
          <button className="btn-ghost">Add</button>
        </form>
      </section>
    </div>
  );
}
