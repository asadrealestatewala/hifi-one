import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { brandFor } from "@/lib/email-template-store";
import { FOLLOW_UP_VARIABLES, STARTER_FOLLOW_UPS } from "@/lib/email-templates";
import EmailTemplateEditor from "@/components/EmailTemplateEditor";
import { ConfirmButton, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { archiveFollowUpTemplateAction, saveFollowUpTemplateAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function FollowUpTemplate({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("followups.manage");
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  const t = isNew ? null : await db.emailTemplate.findFirst({ where: { id, organizationId: user.organizationId, kind: "FOLLOW_UP" } });
  if (!isNew && !t) notFound();
  const brand = await brandFor(db, user.organizationId);
  const starter = STARTER_FOLLOW_UPS[0].content;
  const initial = t
    ? { name: t.name, subject: t.subject, preheader: t.preheader, heading: t.heading, body: t.body, buttonLabel: t.buttonLabel, buttonUrl: t.buttonUrl, highlights: t.highlights }
    : { name: "", subject: "", preheader: "", heading: "", body: "Hi {{first_name}},\n\n", buttonLabel: starter.buttonLabel, buttonUrl: "mailto:{{owner_email}}", highlights: "" };
  return (
    <div className="space-y-5">
      <Link href="/leads/follow-ups" className="text-sm text-muted hover:underline">← Follow-up sequences</Link>
      <PageHeader title={t ? t.name : "New follow-up template"} subtitle="Follow-up emails go to leads, signed by their owner, with an unsubscribe link added automatically."
        actions={t ? (
          <form action={archiveFollowUpTemplateAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="archived" value={t.archived ? "0" : "1"} />
            {t.archived ? <SubmitButton className="btn-ghost">Restore</SubmitButton> : <ConfirmButton title="Archive this template?" message="It can no longer be picked for a sequence. Sequences that are paused keep it until you change them." confirmLabel="Archive">Archive</ConfirmButton>}
          </form>
        ) : undefined} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <EmailTemplateEditor action={saveFollowUpTemplateAction} hidden={{ id: t?.id ?? "" }} initial={initial} variables={FOLLOW_UP_VARIABLES} brand={brand} withName withButtonUrl unsubscribe />
    </div>
  );
}
