// "Forgot password" from the sign-in page. The answer never reveals whether an account exists. A link is only
// sent to the account's registered email when outgoing mail is configured; numbers get nothing until an SMS
// provider is connected (src/lib/sms.ts). The outbox keeps the message without the secret link.
import type { PrismaClient } from "@prisma/client";
import { createResetLink } from "./accounts";
import { parseLoginIdentifier } from "./login-identifier";
import { isConfigured as mailConfigured } from "./mailer";
import { firstName, sendTemplate } from "./email-template-store";
import { isSmsConfigured } from "./sms";

export const HELP_MESSAGE = "If the details match an active account and a delivery method is set up, a reset link is on its way. If nothing arrives, ask your administrator for a setup link.";

export async function requestPasswordHelp(db: PrismaClient, p: { identifier: string; origin: string }): Promise<{ sent: "email" | null }> {
  const id = parseLoginIdentifier(p.identifier);
  if (!id) return { sent: null };
  const user = await db.user.findUnique({ where: id.kind === "email" ? { email: id.value } : { phone: id.value } });
  if (!user || !user.active || user.userType !== "EMPLOYEE") return { sent: null };
  if (id.kind === "phone" && !isSmsConfigured()) return { sent: null };
  if (!user.email || !mailConfigured()) return { sent: null };
  const token = await createResetLink(db, { organizationId: user.organizationId, userId: user.id, createdById: user.id, hours: 1 });
  // The outbox keeps the message without the secret link
  await sendTemplate(db, { organizationId: user.organizationId, key: "password_reset", to: user.email, relatedType: "User", relatedId: user.id, secret: true, buttonUrl: `${p.origin}/reset/${token}`, vars: { first_name: firstName(user.name), link: `${p.origin}/reset/${token}` } });
  await db.auditLog.create({ data: { organizationId: user.organizationId, actorId: user.id, action: "auth.password_help", entity: "User", entityId: user.id } });
  return { sent: "email" };
}
