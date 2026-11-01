import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, ConfirmButton, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { memberAction, updateMailboxAction } from "../actions";

export const dynamic = "force-dynamic";

const PURPOSE_NOTE: Record<string, string> = {
  NOREPLY: "Sends password resets, meeting invitations and test emails. Replies land here only if someone is a member.",
  BILLING: "Sends invoices, quotations and account statements. Client replies to those emails come back here.",
  HR: "For conversations with staff and applicants.",
  ONBOARDING: "For welcoming new clients and staff.",
  FINANCE: "For payments, vendor bills and finance questions.",
};

// Administration only: who may use the mailbox. This page never shows the mailbox's conversations.
export default async function MailboxAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("mail.manage");
  const { id } = await params;
  const sp = await searchParams;
  const mb = await db.mailbox.findFirst({ where: { id, organizationId: user.organizationId }, include: { members: true } });
  if (!mb) notFound();
  const staff = await db.user.findMany({ where: { organizationId: user.organizationId, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const names = new Map(staff.map((u) => [u.id, u.name]));
  const memberIds = new Set(mb.members.map((m) => m.userId));
  const candidates = staff.filter((u) => !memberIds.has(u.id));
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="text-sm"><Link href="/settings/mailboxes" className="text-muted hover:underline">← Mailboxes</Link></div>
      <PageHeader title={mb.address} subtitle={mb.kind === "SYSTEM" ? PURPOSE_NOTE[mb.purpose ?? ""] : mb.kind === "PERSONAL" ? `Personal mailbox of ${names.get(mb.ownerId ?? "") ?? "a former employee"}.` : "Shared team mailbox."}
        actions={<>{mb.kind === "SYSTEM" ? <Badge tone="primary">{mb.purpose?.toLowerCase()}</Badge> : <Badge>{mb.kind.toLowerCase()}</Badge>}{mb.active ? <Badge tone="success">active</Badge> : <Badge>off</Badge>}</>} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <form action={updateMailboxAction} className="card space-y-3">
        <h2 className="font-semibold">Details</h2>
        <input type="hidden" name="id" value={mb.id} />
        <div><label className="label" htmlFor="displayName">Name shown to recipients</label><input id="displayName" name="displayName" className="input" defaultValue={mb.displayName} required maxLength={80} /></div>
        <div><label className="label" htmlFor="signature">Signature (added to emails sent from the mailbox screen)</label><textarea id="signature" name="signature" rows={3} className="input" defaultValue={mb.signature ?? ""} maxLength={1000} /></div>
        <SubmitButton>Save</SubmitButton>
      </form>

      <section className="card space-y-3">
        <h2 className="font-semibold">Members</h2>
        {mb.members.length === 0 ? <p className="text-sm text-muted">Nobody can use this mailbox yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {mb.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{names.get(m.userId) ?? "Inactive user"} {m.userId === mb.ownerId && <Badge tone="primary">owner</Badge>} <span className="text-muted">· {m.canSend ? "reads and sends" : "reads only"}</span></span>
                <span className="flex gap-2">
                  <form action={memberAction}><input type="hidden" name="id" value={mb.id} /><input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="op" value={m.canSend ? "read-only" : "allow-send"} /><button className="btn-ghost">{m.canSend ? "Make read-only" : "Allow sending"}</button></form>
                  {m.userId !== mb.ownerId && <form action={memberAction}><input type="hidden" name="id" value={mb.id} /><input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="op" value="remove" /><ConfirmButton title="Remove member?" message={`${names.get(m.userId) ?? "This person"} will no longer see ${mb.address}.`} confirmLabel="Remove">Remove</ConfirmButton></form>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {candidates.length > 0 && (
          <form action={memberAction} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <input type="hidden" name="id" value={mb.id} /><input type="hidden" name="op" value="add" />
            <div className="min-w-56 flex-1"><label className="label" htmlFor="userId">Add a person</label><select id="userId" name="userId" className="input">{candidates.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="canSend" defaultChecked /> Can send</label>
            <SubmitButton>Add member</SubmitButton>
          </form>
        )}
      </section>

      <form action={updateMailboxAction} className="card flex flex-wrap items-center justify-between gap-3 text-sm">
        <input type="hidden" name="id" value={mb.id} /><input type="hidden" name="op" value={mb.active ? "deactivate" : "activate"} />
        <p className="text-muted">{mb.active ? "Switching a mailbox off hides it from its members and stops it receiving. Its conversations are kept." : "This mailbox is switched off."}</p>
        {mb.active ? <ConfirmButton title={`Switch off ${mb.address}?`} message="Members lose access and new emails to this address are ignored. Nothing is deleted." confirmLabel="Switch off">Switch off</ConfirmButton> : <SubmitButton className="btn-ghost">Switch on</SubmitButton>}
      </form>
    </div>
  );
}
