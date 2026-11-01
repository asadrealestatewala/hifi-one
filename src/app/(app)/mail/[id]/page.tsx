import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mailboxFor, threadFor } from "@/lib/mailboxes";
import { Badge, Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";
import { markThreadAction, sendMailAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_NOTE: Record<string, string> = { NOT_CONFIGURED: "Not sent: email is not connected", FAILED: "Not sent" };

export default async function MailThreadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const t = await threadFor(db, user, id);
  if (!t) notFound();
  // Opening a conversation marks it read.
  if (t.unread > 0) await db.mailThread.update({ where: { id: t.id }, data: { unread: 0 } });
  const [messages, member, client, contact, employee] = await Promise.all([
    db.mailMessage.findMany({ where: { threadId: t.id }, orderBy: { createdAt: "asc" } }),
    mailboxFor(db, user, t.mailboxId, { send: true }),
    t.clientId ? db.client.findFirst({ where: { id: t.clientId, organizationId: user.organizationId }, select: { id: true, name: true } }) : null,
    t.contactId ? db.contact.findFirst({ where: { id: t.contactId, organizationId: user.organizationId }, select: { id: true, name: true } }) : null,
    t.employeeId ? db.user.findFirst({ where: { id: t.employeeId, organizationId: user.organizationId }, select: { id: true, name: true } }) : null,
  ]);
  const senders = new Map((await db.user.findMany({ where: { id: { in: [...new Set(messages.map((m) => m.sentById).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const subject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;
  const can = (p: string) => user.permissions.has(p as never);
  return (
    <div className="space-y-5 max-w-4xl">
      <div className="text-sm"><Link href={`/mail?box=${t.mailboxId}`} className="text-muted hover:underline">← {t.mailbox.address}</Link></div>
      <PageHeader title={t.subject}
        subtitle={<>With {t.counterpart}{client && <> · Client: {can("clients.view") ? <Link className="underline" href={`/clients/${client.id}`}>{client.name}</Link> : client.name}</>}{contact && <> · Contact: {can("crm.view") ? <Link className="underline" href={`/contacts/${contact.id}`}>{contact.name}</Link> : contact.name}</>}{employee && <> · Staff: {employee.name}</>}</>}
        actions={<>
          <form action={markThreadAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="op" value="unread" /><button className="btn-ghost">Mark unread</button></form>
          <form action={markThreadAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="op" value={t.status === "ARCHIVED" ? "unarchive" : "archive"} /><button className="btn-ghost">{t.status === "ARCHIVED" ? "Move to inbox" : "Archive"}</button></form>
        </>} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <ol className="space-y-3">
        {messages.map((m) => (
          <li key={m.id} className={`card space-y-2 ${m.direction === "OUT" ? "border-l-4 border-l-primary" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span><strong>{m.direction === "OUT" ? (m.sentById ? senders.get(m.sentById) ?? m.fromName : m.fromName ?? "System") : m.fromName ?? m.fromAddress}</strong> <span className="text-muted">&lt;{m.fromAddress}&gt;</span></span>
              <span className="text-xs text-muted">{m.createdAt.toLocaleString()}</span>
            </div>
            <div className="text-xs text-muted">To {m.toAddresses.join(", ")}{m.ccAddresses.length > 0 && <> · Cc {m.ccAddresses.join(", ")}</>}</div>
            {m.direction === "OUT" && m.status !== "SENT" && <p className="text-xs"><StatusBadge status={m.status === "NOT_CONFIGURED" ? "NOT_SENT" : m.status} /> <span className="text-muted">{STATUS_NOTE[m.status]}{m.error && m.status === "FAILED" ? `: ${m.error}` : ""}</span></p>}
            {m.relatedType && <p className="text-xs text-muted">Sent automatically ({m.relatedType.toLowerCase()})</p>}
            <div className="whitespace-pre-wrap break-words text-sm">{m.text || <span className="text-muted">(no text)</span>}</div>
            {m.attachmentNames.length > 0 && <div className="flex flex-wrap gap-1">{m.attachmentNames.map((a, i) => <Badge key={i}>📎 {a}</Badge>)}</div>}
          </li>
        ))}
      </ol>
      {member ? (
        <form action={sendMailAction} className="card space-y-3">
          <h2 className="font-semibold">Reply from {t.mailbox.address}</h2>
          <input type="hidden" name="threadId" value={t.id} />
          <input type="hidden" name="mailboxId" value={t.mailboxId} />
          <input type="hidden" name="subject" value={subject} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="to">To</label><input id="to" name="to" className="input" defaultValue={t.counterpart} required /></div>
            <div><label className="label" htmlFor="cc">Cc (optional)</label><input id="cc" name="cc" className="input" placeholder="name@example.com, other@example.com" /></div>
          </div>
          <div><label className="label" htmlFor="text">Message</label><textarea id="text" name="text" rows={7} className="input" required maxLength={50_000} /></div>
          {t.mailbox.signature && <p className="text-xs text-muted">Your mailbox signature is added at the end.</p>}
          <SubmitButton pendingText="Sending…">Send reply</SubmitButton>
        </form>
      ) : <p className="text-sm text-muted">You can read this mailbox but not send from it.</p>}
    </div>
  );
}
