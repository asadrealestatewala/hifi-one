// Plumbing for the native mobile app's JSON API (/api/mobile/v1/*).
// The app signs in with the same account rules as the website (same password check, lockout, onboarding gate and two-step
// verification), then holds the same signed session token in the phone's secure storage and sends it as a bearer token.
// Sessions are the ordinary database sessions: signing out or deactivating a person ends the app session too.
import { db } from "./db";
import { json } from "./agent-http";
import { userFromToken, type SessionUser } from "./auth";
import { needsMfaSetup } from "./mfa-policy";
import { limiter } from "./rate-limit";

export { json };

export const bearerToken = (req: Request) => {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
};

// Staff only. Every mobile route calls this first, so authorization is decided on the server for each request.
// `permission` additionally requires one named permission.
export async function requireMobileUser(req: Request, permission?: string): Promise<{ user: SessionUser; token: string } | Response> {
  const token = bearerToken(req);
  if (!token) return json({ error: "Sign in to continue." }, 401);
  const user = await userFromToken(token);
  if (!user) return json({ error: "Your session has ended. Sign in again." }, 401);
  if (!limiter("mobile-user", 600, 600_000).take(user.id)) return json({ error: "Too many requests. Please wait a moment." }, 429);
  if (user.userType !== "EMPLOYEE") return json({ error: "This app is for staff. Clients and vendors use the web portal." }, 403);
  if (user.mustChangePassword) return json({ error: "Set a new password on the website first, then sign in again.", code: "password_change" }, 403);
  if (needsMfaSetup(user)) return json({ error: "Your role requires two-step verification. Set it up on the website first.", code: "mfa_setup" }, 403);
  if (permission && !user.permissions.has(permission as never)) return json({ error: "You do not have access to this." }, 403);
  return { user, token };
}

export const isResponse = (x: unknown): x is Response => x instanceof Response;

export async function companyZone(organizationId: string) {
  const p = await db.companyProfile.findFirst({ where: { organizationId, isDefault: true } });
  return p?.timezone ?? "UTC";
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

export const publicUser = (u: SessionUser) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, roles: u.roles,
  can: {
    tasks: true, editTasks: u.permissions.has("tasks.edit"), attendance: u.permissions.has("self.attendance"), leave: u.permissions.has("self.leave"),
  },
});
