"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailInvoice, emailQuote, emailStatement } from "@/lib/email-docs";
import { MailError, sendEmail, verifyMail } from "@/lib/mailer";

const safeReturn = (p: string) => (p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/dashboard");
const flash = (to: string, kind: "mailOk" | "mailError", msg: string) => `${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`;

// One form on the invoice, quotation and client pages. The recipient is typed or prefilled; it is validated as a single address.
export async function emailDocumentAction(formData: FormData) {
  const kind = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? ""));
  const user = await requirePermission(kind === "QUOTE" ? "quotes.manage" : "finance.post");
  try {
    const org = user.organizationId;
    const m = kind === "INVOICE" ? await emailInvoice(db, { organizationId: org, invoiceId: id, to, actorId: user.id })
      : kind === "QUOTE" ? await emailQuote(db, { organizationId: org, quoteId: id, to, actorId: user.id })
      : kind === "STATEMENT" ? await emailStatement(db, { organizationId: org, clientId: id, to, actorId: user.id })
      : null;
    if (!m) redirect(flash(returnTo, "mailError", "Unknown document."));
    await audit(user, { action: "email.document", entity: "EmailMessage", entityId: m.id, after: { kind, to: m.toEmail, status: m.status } });
    if (m.status === "SENT") redirect(flash(returnTo, "mailOk", `Emailed to ${m.toEmail}.`));
    redirect(flash(returnTo, "mailError", m.status === "NOT_CONFIGURED" ? "Email is not connected, so nothing was sent. See Settings > Email." : `The mail server did not accept it: ${m.error}`));
  } catch (e) {
    if (e instanceof MailError) redirect(flash(returnTo, "mailError", e.message));
    throw e;
  }
}

export async function testEmailAction(formData: FormData) {
  const user = await requirePermission("settings.company.edit");
  const op = String(formData.get("op") ?? "");
  if (op === "verify") {
    const r = await verifyMail();
    await audit(user, { action: "email.verify", entity: "EmailMessage", after: { ok: r.ok } });
    redirect(`/settings/email?${r.ok ? "ok" : "error"}=${encodeURIComponent(r.message)}`);
  }
  try {
    const m = await sendEmail(db, { organizationId: user.organizationId, to: user.email, subject: "Hifi One test email", text: "This is a test email from Hifi One. If you can read it, outgoing email works.", relatedType: "TEST", actorId: user.id });
    await audit(user, { action: "email.test", entity: "EmailMessage", entityId: m.id, after: { status: m.status } });
    redirect(`/settings/email?${m.status === "SENT" ? "ok" : "error"}=${encodeURIComponent(m.status === "SENT" ? `Test email sent to ${user.email}.` : (m.error ?? "Not sent."))}`);
  } catch (e) {
    if (e instanceof MailError) redirect(`/settings/email?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
