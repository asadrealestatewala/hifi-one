import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { brandFor, systemContent } from "@/lib/email-template-store";
import { systemTemplate } from "@/lib/email-templates";
import EmailTemplateEditor from "@/components/EmailTemplateEditor";
import { ConfirmButton, Notice, PageHeader } from "@/components/ui";
import { resetSystemTemplateAction, saveSystemTemplateAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditTemplate({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ reset?: string }> }) {
  const user = await requirePermission("email_templates.manage");
  const { key } = await params;
  const sp = await searchParams;
  if (!systemTemplate(key)) notFound();
  const [{ def, content, edited }, brand] = await Promise.all([systemContent(db, user.organizationId, key), brandFor(db, user.organizationId)]);
  return (
    <div className="space-y-5">
      <PageHeader title={def.name} subtitle={<>{def.description} <Link className="underline" href="/settings/email-templates">All templates</Link></>}
        actions={edited ? (
          <form action={resetSystemTemplateAction}><input type="hidden" name="key" value={key} />
            <ConfirmButton title="Go back to the default wording?" message="Your edited wording for this email is removed. Emails sent from now on use the built-in text." confirmLabel="Reset">Reset to default</ConfirmButton>
          </form>
        ) : undefined} />
      {sp.reset && <Notice kind="ok">Back to the default wording.</Notice>}
      <EmailTemplateEditor key={edited ? "edited" : "default"} action={saveSystemTemplateAction} hidden={{ key }} initial={content} variables={def.variables} brand={brand} blocks={def.blocks}
        sampleButtonUrl={def.buttonUrlVar ? def.variables[def.buttonUrlVar] : null} />
    </div>
  );
}
