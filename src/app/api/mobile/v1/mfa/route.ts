import { createSession, userFromToken, userIdFromMfaToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkSecondFactor } from "@/lib/mfa";
import { limiter } from "@/lib/rate-limit";
import { json, publicUser, readJson, str } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

// Step two of mobile sign-in: the authenticator code (or one recovery code) plus the pending token from step one. Public by design:
// the pending token proves the password was right and lasts five minutes.
export async function POST(req: Request) {
  const body = await readJson(req);
  const uid = await userIdFromMfaToken(str(body.mfaToken, 2000));
  if (!uid) return json({ error: "Your sign-in timed out. Please start again.", restart: true }, 401);
  if (!limiter("mfa-user", 6, 10 * 60_000).take(uid)) return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  const user = await db.user.findUnique({ where: { id: uid } });
  if (!user || !user.active || !user.totpEnabled || user.userType !== "EMPLOYEE") return json({ error: "Your sign-in timed out. Please start again.", restart: true }, 401);
  const result = await checkSecondFactor(db, user, str(body.code, 40), process.env.SESSION_SECRET ?? "");
  if (!result.ok) {
    await db.auditLog.create({ data: { organizationId: user.organizationId, actorId: user.id, action: "auth.mfa_failed", entity: "User", entityId: user.id } });
    return json({ error: "That code is not correct." }, 401);
  }
  if (result.usedRecoveryCode) await db.auditLog.create({ data: { organizationId: user.organizationId, actorId: user.id, action: "auth.recovery_code_used", entity: "User", entityId: user.id } });
  const { token, expiresAt } = await createSession(user, { userAgent: req.headers.get("user-agent") ?? "Hifi One mobile", ip: req.headers.get("x-forwarded-for") });
  const su = await userFromToken(token);
  return json({ token, expiresAt, user: su ? publicUser(su) : null });
}
