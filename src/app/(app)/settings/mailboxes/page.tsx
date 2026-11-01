import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailConfig } from "@/lib/mailer";
import { STANDARD_MAILBOXES, mailDomain, receivingConfig } from "@/lib/mailboxes";
import { baseUrl } from "@/lib/meeting-cookie";
import { Badge, Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { createMailboxAction, setupStandardAction } from "./actions";

export const dynamic = "force-dynamic";

// A suggested address for an employee: first.last from their name, letters and digits only.
const suggest = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(0, 2).join(".");

export default async function MailboxSettings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("mail.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const [boxes, staff] = await Promise.all([
    db.mailbox.findMany({ where: { organizationId: org }, orderBy: [{ kind: "desc" }, { address: "asc" }], include: { _count: { select: { members: true } } } }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
  ]);
  const owners = new Map(staff.map((u) => [u.id, u.name]));
  const withBox = new Set(boxes.filter((b) => b.kind === "PERSONAL" && b.active).map((b) => b.ownerId));
  const without = staff.filter((u) => !withBox.has(u.id));
  const missingStandard = STANDARD_MAILBOXES.filter((s) => !boxes.some((b) => b.purpose === s.purpose));
  const send = mailConfig();
  const recv = receivingConfig();
  const domain = mailDomain();
  const webhook = `${await baseUrl()}/api/mail/inbound`;
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Mailboxes" subtitle={<>Company addresses on {domain}. Each person reads and sends with their own Hifi One sign-in; nobody, administrators included, can open a mailbox they are not a member of.</>} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">Connection</h2>
        <p>Sending: <strong className={send.transportReady ? "text-green-700" : "text-amber-600"}>{send.provider === "RESEND_API" ? "Resend API key set" : send.provider === "SMTP" ? `SMTP (${send.host})` : "Not connected"}</strong>{send.transportReady && <span className="text-muted"> · test it under <Link className="underline" href="/settings/email">Settings › Email</Link></span>}</p>
        <p>Receiving: <strong className={recv.configured ? "text-green-700" : "text-amber-600"}>{recv.configured ? "Webhook secret and API key set (not proven until an email arrives)" : "Not connected"}</strong></p>
        {!recv.configured && (
          <div className="text-muted space-y-1">
            <p>To receive replies: in Resend, add {domain} (or a subdomain) with receiving switched on and add its MX record at your DNS host; then create a webhook for the <code>email.received</code> event pointing to <code className="break-all">{webhook}</code>; then set <code>RESEND_API_KEY</code> (full access) and <code>RESEND_WEBHOOK_SECRET</code> on the server and restart.</p>
            <p>Changing the MX record of {domain} moves all of its incoming mail to Resend. If the domain already receives mail somewhere else, use a subdomain or forwarding instead.</p>
          </div>
        )}
        <p className="text-muted">Addresses are created on <code>{domain}</code> (server setting <code>MAIL_DOMAIN</code>). Sending only works once that domain is verified in Resend.</p>
      </section>

      {missingStandard.length > 0 && (
        <section className="card flex flex-wrap items-center justify-between gap-3 text-sm">
          <div><h2 className="font-semibold">Standard company mailboxes</h2><p className="text-muted">Creates {missingStandard.map((s) => `${s.local}@${domain}`).join(", ")}. Invoices, quotations and statements then go out from billing@; password resets, meeting invitations and tests from noreply@.</p></div>
          <form action={setupStandardAction}><SubmitButton pendingText="Creating…">Create them</SubmitButton></form>
        </section>
      )}

      <section className="card !p-0 overflow-x-auto">
        <h2 className="px-4 pt-4 font-semibold">All mailboxes</h2>
        {boxes.length === 0 ? <div className="p-4"><Empty title="No mailboxes yet">Create the standard ones above, then a mailbox for each employee below.</Empty></div> : (
          <table className="mt-2 w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Address</th><th className="pr-4">Type</th><th className="pr-4">Belongs to</th><th className="pr-4">Members</th><th className="pr-4">Status</th></tr></thead>
            <tbody>{boxes.map((b) => (
              <tr key={b.id} className="border-t border-border hover:bg-hover/50">
                <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`/settings/mailboxes/${b.id}`}>{b.address}</Link><span className="block text-xs text-muted">{b.displayName}</span></td>
                <td className="pr-4">{b.kind === "SYSTEM" ? <Badge tone="primary">{b.purpose?.toLowerCase()}</Badge> : <Badge>{b.kind.toLowerCase()}</Badge>}</td>
                <td className="pr-4">{b.ownerId ? owners.get(b.ownerId) ?? "Former employee" : <span className="text-muted">Company</span>}</td>
                <td className="pr-4">{b._count.members}</td>
                <td className="pr-4">{b.active ? <Badge tone="success">active</Badge> : <Badge>off</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <section className="card space-y-3 text-sm">
        <h2 className="font-semibold">Shared team mailbox</h2>
        <p className="text-muted">For an address several people answer, such as sales@ or support@. Add its members after creating it.</p>
        <form action={createMailboxAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="kind" value="SHARED" />
          <div><label className="label" htmlFor="sh-local">Address</label><div className="flex items-center gap-1"><input id="sh-local" name="localPart" className="input" required placeholder="sales" /><span className="text-muted">@{domain}</span></div></div>
          <div><label className="label" htmlFor="sh-name">Name shown to recipients</label><input id="sh-name" name="displayName" className="input" required placeholder="Hifi Marketing Sales" /></div>
          <SubmitButton pendingText="Creating…">Create mailbox</SubmitButton>
        </form>
      </section>

      <section className="card !p-0 overflow-x-auto">
        <div className="px-4 pt-4"><h2 className="font-semibold">Employee mailboxes</h2><p className="text-sm text-muted">Each employee signs in to Hifi One as usual and finds their mailbox under My Space › Mailbox. An employee can have more than one: create the extra one here or as a shared mailbox.</p></div>
        {without.length === 0 ? <p className="p-4 text-sm text-muted">Every active employee has a personal mailbox.</p> : (
          <table className="mt-2 w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Employee without a mailbox</th><th className="pr-4">New address</th><th className="pr-4"></th></tr></thead>
            <tbody>{without.map((u) => (
              <tr key={u.id} className="border-t border-border align-middle">
                <td className="px-4 py-2">{u.name}<span className="block text-xs text-muted">Sign-in: {u.email ?? "phone number"}</span></td>
                <td className="pr-4" colSpan={2}>
                  <form action={createMailboxAction} className="flex flex-wrap items-center gap-2 py-2">
                    <input type="hidden" name="kind" value="PERSONAL" /><input type="hidden" name="ownerId" value={u.id} /><input type="hidden" name="displayName" value={u.name} />
                    <label className="sr-only" htmlFor={`lp-${u.id}`}>Address for {u.name}</label>
                    <input id={`lp-${u.id}`} name="localPart" className="input !w-44" required defaultValue={suggest(u.name)} /><span className="text-muted">@{domain}</span>
                    <SubmitButton className="btn-ghost" pendingText="Creating…">Create</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {staff.length > without.length && (
          <details className="border-t border-border px-4 py-3 text-sm">
            <summary className="cursor-pointer">Add another mailbox for an employee who already has one</summary>
            <form action={createMailboxAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="kind" value="PERSONAL" />
              <div><label className="label" htmlFor="ex-owner">Employee</label><select id="ex-owner" name="ownerId" className="input" required>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
              <div><label className="label" htmlFor="ex-local">Address</label><div className="flex items-center gap-1"><input id="ex-local" name="localPart" className="input" required /><span className="text-muted">@{domain}</span></div></div>
              <div><label className="label" htmlFor="ex-name">Name shown to recipients</label><input id="ex-name" name="displayName" className="input" required /></div>
              <SubmitButton pendingText="Creating…">Create</SubmitButton>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
