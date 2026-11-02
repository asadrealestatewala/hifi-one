import { checkCredentials, createSession, mfaPendingToken } from "@/lib/auth";
import { json, publicUser, readJson, str } from "@/lib/mobile-api";
import { userFromToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Step one of mobile sign-in: email or phone plus password. Public by design; the same limits and lockout as the website apply.
export async function POST(req: Request) {
  const body = await readJson(req);
  const checked = await checkCredentials(str(body.identifier, 200), str(body.password, 200), req.headers.get("x-forwarded-for"));
  if (!checked.ok) return json({ error: checked.error }, checked.error.startsWith("Too many") ? 429 : 401);
  const user = checked.user;
  if (user.userType !== "EMPLOYEE") return json({ error: "This app is for staff. Clients and vendors use the web portal." }, 403);
  if (user.totpEnabled) return json({ mfaRequired: true, mfaToken: await mfaPendingToken(user.id) });
  const { token, expiresAt } = await createSession(user, { userAgent: req.headers.get("user-agent") ?? "Hifi One mobile", ip: req.headers.get("x-forwarded-for") });
  const su = await userFromToken(token);
  return json({ token, expiresAt, user: su ? publicUser(su) : null });
}
