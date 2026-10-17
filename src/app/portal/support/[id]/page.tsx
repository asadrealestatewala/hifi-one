import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SupportError, clientReply, portalRequest } from "@/lib/support";
import { Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

async function reply(formData: FormData): Promise<void> {
  "use server";
  const user = await requireClientUser();
  const id = String(formData.get("id") ?? "");
  try {
    await clientReply(db, { organizationId: user.organizationId, clientId: user.clientId, userId: user.id, requestId: id, body: String(formData.get("body") ?? "") });
    await audit(user, { action: "portal.support_reply", entity: "SupportRequest", entityId: id });
  } catch (e) {
    if (e instanceof SupportError) redirect(`/portal/support/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/portal/support/${id}`);
}

export default async function PortalSupportRequest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireClientUser();
  const { id } = await params;
  const sp = await searchParams;
  const r = await portalRequest(db, user.clientId, id);
  if (!r) notFound();
  return (
    <div className="space-y-5">
      <Link href="/portal/support" className="text-sm text-muted hover:underline">← All requests</Link>
      <PageHeader title={r.subject} subtitle={`${r.number} · opened ${r.createdAt.toLocaleDateString()}`} actions={<StatusBadge status={r.status} />} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <ul className="space-y-3">
        {r.messages.map((m) => (
          <li key={m.id} className={`card max-w-3xl space-y-1 text-sm ${m.mine ? "ml-auto bg-primary/5" : ""}`}>
            <p className="text-xs text-muted"><span className="font-medium text-foreground">{m.mine ? "You" : m.author}</span> · {m.at.toLocaleString()}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      {r.status === "CLOSED" ? <p className="text-sm text-muted">This request is closed. Open a new one if you need more help.</p> : (
        <form action={reply} className="card max-w-3xl space-y-2">
          <input type="hidden" name="id" value={r.id} />
          <label className="label" htmlFor="r-body">{r.status === "RESOLVED" ? "Not solved? Reply to reopen it" : "Reply"}</label>
          <textarea id="r-body" name="body" required maxLength={4000} rows={3} className="input" />
          <SubmitButton pendingText="Sending…">Send</SubmitButton>
        </form>
      )}
    </div>
  );
}
