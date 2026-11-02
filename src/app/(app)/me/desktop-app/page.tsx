import { requirePermission } from "@/lib/auth";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { getPolicy, hasAccepted } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

export default async function DesktopApp() {
  const user = await requirePermission("monitoring.own");
  const policy = await getPolicy(db, user.organizationId);
  const [accepted, devices] = await Promise.all([
    policy.enabled ? hasAccepted(db, user.id, policy.version) : Promise.resolve(false),
    db.monitorDevice.findMany({ where: { userId: user.id }, orderBy: { enrolledAt: "desc" }, take: 10 }),
  ]);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title="Desktop app" subtitle="Records your work time from your Windows computer, only as your organization's policy says. A window on your screen always shows what it is doing." />

      {!policy.enabled ? (
        <Empty title="Not switched on yet">Your organization has not turned on time and activity tracking, so there is nothing to install. This page will offer the download when it is.</Empty>
      ) : (
        <section className="card space-y-4">
          <h2 className="font-semibold">Install on this computer</h2>
          <form method="post" action="/api/agent/download">
            <button className="btn">Download for Windows</button>
          </form>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Press <strong>Download for Windows</strong>. The file name already contains your one-time code, so keep the name as it is.</li>
            <li>Open the file. Windows may say it does not recognise the publisher; choose <em>More info</em>, then <em>Run anyway</em>.</li>
            <li>The window connects this computer to your account, sets the app to open when you sign in to Windows, and shows what it records. Nothing else to type.</li>
          </ol>
          {!accepted && <p className="rounded-xl border border-border bg-hover p-3 text-sm">Nothing is recorded until you have read and accepted the monitoring policy on <a className="text-primary hover:underline" href="/me/time">My Workfolio</a>.</p>}
          <p className="text-xs text-muted">The code works once and expires in an hour; press Download again for a new one. If HR sent you a code instead, run the file, then type the code when it asks. To remove the app, run it with <code>uninstall</code> after its name, or ask HR to revoke the computer. Never recorded: what you type, window titles, web addresses, passwords. See <a className="underline" href="/me/time">what is recorded about you</a>.</p>
        </section>
      )}

      <section className="card space-y-2">
        <h2 className="font-semibold">Your computers</h2>
        {devices.length === 0 ? <p className="text-sm text-muted">No computer is connected yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{d.name}<span className="block text-xs text-muted">{d.os} {d.agentVersion && `· v${d.agentVersion}`} · connected {d.enrolledAt.toLocaleDateString()} · last seen {d.lastSeenAt ? d.lastSeenAt.toLocaleString() : "never"}</span></span>
                {d.revokedAt ? <Badge tone="danger">revoked</Badge> : <Badge tone="success">active</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
