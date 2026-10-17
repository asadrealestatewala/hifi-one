import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { intact } from "@/lib/agreements";
import { ConfirmButton, Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";
import { editAgreementAction, voidAgreementAction } from "../actions";
import SendForm from "../SendForm";

export const dynamic = "force-dynamic";

export default async function AgreementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("contracts.view");
  const { id } = await params;
  const sp = await searchParams;
  const a = await db.agreement.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!a) notFound();
  const canManage = user.permissions.has("contracts.manage");
  const [client, vendor, creator] = await Promise.all([
    a.clientId ? db.client.findFirst({ where: { id: a.clientId, organizationId: user.organizationId }, select: { id: true, name: true, email: true } }) : null,
    a.vendorId ? db.vendor.findFirst({ where: { id: a.vendorId, organizationId: user.organizationId }, select: { id: true, name: true, email: true } }) : null,
    db.user.findFirst({ where: { id: a.createdById }, select: { name: true } }),
  ]);
  const party = client ?? vendor;
  const sealed = a.status !== "DRAFT";
  const expired = a.status === "SENT" && a.tokenExpiresAt !== null && a.tokenExpiresAt < new Date();
  return (
    <div className="space-y-5">
      <Link href="/agreements" className="text-sm text-muted hover:underline">← All agreements</Link>
      <PageHeader title={a.title} subtitle={<span className="flex flex-wrap items-center gap-2">{a.number}<StatusBadge status={a.status} />{party && <span>· {client ? <Link className="hover:underline" href={`/clients/${client.id}`}>{party.name}</Link> : <Link className="hover:underline" href={`/vendors/${vendor!.id}`}>{party.name}</Link>}</span>}</span>}
        actions={<a href={`/agreements/${a.id}/pdf`} target="_blank" rel="noreferrer" className="btn-ghost">Download PDF</a>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      {a.status === "SIGNED" && (
        <section className="card space-y-1 text-sm">
          <h2 className="font-semibold">Signed</h2>
          <p>{a.signerName} signed on {a.signedAt?.toISOString().slice(0, 16).replace("T", " ")} UTC{a.signedIp ? ` from ${a.signedIp}` : ""}.</p>
          <p className="text-xs text-muted">Fingerprint of the signed text: <span className="font-mono">{a.bodyHash}</span> · {intact(a) ? "the stored text still matches it" : "THE STORED TEXT NO LONGER MATCHES the signed fingerprint"}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a small data URL drawn by the signer; nothing to optimise */}
          {a.signatureImage && <img src={a.signatureImage} alt={`Signature drawn by ${a.signerName ?? "the signer"}`} className="mt-2 h-20 rounded border border-border bg-white p-1" />}
        </section>
      )}
      {a.status === "DECLINED" && <Notice kind="error">Declined: {a.declineReason}</Notice>}
      {a.status === "SENT" && <Notice kind="ok">{expired ? "The signing link has expired. Issue a new one below." : `Waiting for ${a.signerName} to sign. The link expires ${a.tokenExpiresAt?.toISOString().slice(0, 10)}.`}</Notice>}

      <section className="card space-y-3">
        <h2 className="font-semibold">Text</h2>
        {!sealed && canManage ? (
          <form action={editAgreementAction} className="space-y-2">
            <input type="hidden" name="id" value={a.id} />
            <div><label className="label" htmlFor="ag-t">Title</label><input id="ag-t" name="title" required maxLength={160} defaultValue={a.title} className="input" /></div>
            <div><label className="label" htmlFor="ag-b">Text</label><textarea id="ag-b" name="body" rows={18} required defaultValue={a.body} className="input font-mono text-xs" /></div>
            <p className="text-xs text-muted">Anything still in {"{{double braces}}"} must be filled before sending.</p>
            <SubmitButton className="btn-ghost">Save changes</SubmitButton>
          </form>
        ) : <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-hover/50 p-3 font-sans text-sm">{a.body}</pre>}
        <p className="text-xs text-muted">Created by {creator?.name ?? "unknown"} on {a.createdAt.toISOString().slice(0, 10)}.{sealed && " The text was frozen when it was sent."}</p>
      </section>

      {canManage && (a.status === "DRAFT" || a.status === "SENT") && <SendForm id={a.id} defaultName={a.signerName ?? ""} defaultEmail={a.signerEmail ?? party?.email ?? ""} resend={a.status === "SENT"} />}
      {canManage && (a.status === "DRAFT" || a.status === "SENT") && (
        <form action={voidAgreementAction}>
          <input type="hidden" name="id" value={a.id} />
          <ConfirmButton className="btn-ghost" title="Void this agreement?" message="It cannot be signed any more and the link stops working. The record is kept." confirmLabel="Void">Void agreement</ConfirmButton>
        </form>
      )}
    </div>
  );
}
