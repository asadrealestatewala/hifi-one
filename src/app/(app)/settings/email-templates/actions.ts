"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { MailError } from "@/lib/mailer";
import { resetSystemTemplate, saveSystemTemplate, sendTemplate } from "@/lib/email-template-store";
import { systemTemplate } from "@/lib/email-templates";
import type { EditorState } from "@/components/EmailTemplateEditor";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function saveSystemTemplateAction(prev: EditorState, formData: FormData): Promise<EditorState> {
  const user = await requirePermission("email_templates.manage");
  const key = s(formData, "key");
  const n = (prev.n ?? 0) + 1;
  try {
    await saveSystemTemplate(db, {
      organizationId: user.organizationId, key, actorId: user.id,
      content: { subject: s(formData, "subject"), preheader: s(formData, "preheader"), heading: s(formData, "heading"), body: s(formData, "body"), buttonLabel: s(formData, "buttonLabel"), highlights: s(formData, "highlights") },
    });
    await audit(user, { action: "email_template.save", entity: "EmailTemplate", entityId: key });
    revalidatePath("/settings/email-templates");
    if (s(formData, "intent") !== "test") return { ok: "Saved. Every email of this kind now uses this wording.", n };
    const def = systemTemplate(key)!;
    if (!user.email) return { error: "Saved, but your account has no email address to send a test to.", n };
    const m = await sendTemplate(db, { organizationId: user.organizationId, key, to: user.email, vars: def.variables, buttonUrl: def.buttonUrlVar ? def.variables[def.buttonUrlVar] : null, relatedType: "TEST", actorId: user.id });
    return m.status === "SENT" ? { ok: `Saved, and a test with sample values went to ${user.email}.`, n } : { error: `Saved, but the test was not sent: ${m.error ?? m.status}`, n };
  } catch (e) {
    if (e instanceof MailError) return { error: e.message, n };
    throw e;
  }
}

export async function resetSystemTemplateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("email_templates.manage");
  const key = s(formData, "key");
  await resetSystemTemplate(db, { organizationId: user.organizationId, key });
  await audit(user, { action: "email_template.reset", entity: "EmailTemplate", entityId: key });
  revalidatePath("/settings/email-templates");
  redirect(`/settings/email-templates/${key}?reset=1`);
}
