import { testEmailAction } from "@/app/email/actions";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { isConfigured, mailConfig } from "@/lib/mailer";

export const dynamic = "force-dynamic";

const COLOR: Record<string, string> = { SENT: "text-green-700", FAILED: "text-brand", NOT_CONFIGURED: "text-amber-600" };

export default async function EmailSettings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("settings.company.view");
  const sp = await searchParams;
  const canEdit = user.permissions.has("settings.company.edit");
  const c = mailConfig();
  const connected = isConfigured();
  const log = await db.emailMessage.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 40 });
  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-bold">Email</h1>
      <p className="text-sm text-muted">Outgoing email uses any SMTP mail account (Google Workspace, Microsoft 365, SendGrid, Mailgun, Amazon SES and others). The login is set by the person who runs the server, in environment settings, not on this screen, so it can never be read from here.</p>
      {sp.ok && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">{sp.ok}</p>}
      {sp.error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{sp.error}</p>}
      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">Connection</h2>
        <p>Status: <strong className={connected ? "text-green-700" : "text-amber-600"}>{connected ? "Settings found (not yet proven until a test succeeds)" : "Not connected"}</strong></p>
        {connected ? (
          <ul className="text-muted"><li>Server: {c.host}:{c.port}{c.secure ? " (secure)" : ""}</li><li>Sign-in: {c.user ? "username and password set" : "none"}</li><li>Sent from: {c.from}</li></ul>
        ) : (
          <p className="text-muted">To connect: set <code>SMTP_HOST</code>, <code>MAIL_FROM</code> and, if your provider needs them, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> in the server environment and restart. Until then, emailing a document records &quot;not sent&quot; and nothing leaves the system.</p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2 pt-2">
            <form action={testEmailAction}><input type="hidden" name="op" value="verify" /><button className="btn-ghost">Test the connection</button></form>
            <form action={testEmailAction}><input type="hidden" name="op" value="send" /><button className="btn-ghost">Send a test email to {user.email}</button></form>
          </div>
        )}
      </section>
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Recent messages</h2>
        {log.length === 0 ? <p className="text-sm text-muted">Nothing sent yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">When</th><th className="pr-3">To</th><th className="pr-3">Subject</th><th>Result</th></tr></thead>
            <tbody>{log.map((m) => (
              <tr key={m.id} className="border-t border-border align-top">
                <td className="py-1 pr-3 whitespace-nowrap">{m.createdAt.toLocaleString()}</td><td className="pr-3">{m.toEmail}</td><td className="pr-3">{m.subject}{m.attachmentName && <span className="block text-xs text-muted">{m.attachmentName}</span>}</td>
                <td><span className={`font-semibold ${COLOR[m.status] ?? ""}`}>{m.status === "NOT_CONFIGURED" ? "Not sent" : m.status.toLowerCase()}</span>{m.error && <span className="block text-xs text-muted">{m.error}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
