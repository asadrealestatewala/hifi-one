import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { myMailboxes } from "@/lib/mailboxes";
import { Empty, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { sendMailAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = { box?: string; to?: string; client?: string; subject?: string; error?: string };

export default async function ComposeMail({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const boxes = (await myMailboxes(db, user)).filter((b) => b.members[0]?.canSend);
  if (boxes.length === 0) {
    return <div className="space-y-5"><PageHeader title="New email" /><Empty title="No mailbox you can send from">Ask your administrator to create a mailbox for you or give you sending rights on a shared one.</Empty></div>;
  }
  // Prefill the client's billing address when started from a client (only if the person can see clients).
  const client = sp.client && user.permissions.has("clients.view") ? await db.client.findFirst({ where: { id: sp.client, organizationId: user.organizationId }, select: { name: true, email: true } }) : null;
  const to = sp.to ?? client?.email ?? "";
  const preferred = boxes.find((b) => b.id === sp.box) ?? boxes.find((b) => b.kind === "PERSONAL") ?? boxes[0];
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="text-sm"><Link href="/mail" className="text-muted hover:underline">← Mailbox</Link></div>
      <PageHeader title="New email" subtitle={client ? `To ${client.name}` : undefined} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <form action={sendMailAction} className="card space-y-3">
        <div><label className="label" htmlFor="mailboxId">From</label>
          <select id="mailboxId" name="mailboxId" className="input" defaultValue={preferred.id}>
            {boxes.map((b) => <option key={b.id} value={b.id}>{b.displayName} &lt;{b.address}&gt;</option>)}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="email" className="input" defaultValue={to} required /></div>
          <div><label className="label" htmlFor="cc">Cc (optional)</label><input id="cc" name="cc" className="input" placeholder="name@example.com, other@example.com" /></div>
        </div>
        <div><label className="label" htmlFor="subject">Subject</label><input id="subject" name="subject" className="input" defaultValue={sp.subject ?? ""} required maxLength={200} /></div>
        <div><label className="label" htmlFor="text">Message</label><textarea id="text" name="text" rows={10} className="input" required maxLength={50_000} /></div>
        <div className="flex gap-2"><SubmitButton pendingText="Sending…">Send email</SubmitButton><Link href="/mail" className="btn-ghost">Cancel</Link></div>
      </form>
    </div>
  );
}
