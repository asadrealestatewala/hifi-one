// Two-step verification can be required per role. Staff holding any active role marked "require two-step verification"
// must turn it on before anything else in the system opens; the only pages they can reach meanwhile are the ones needed
// to set it up, change a password and sign out. Pure functions so the rule is easy to test.

export type MfaFacts = { userType: string; totpEnabled: boolean; mfaRequired: boolean };

export const needsMfaSetup = (u: MfaFacts) => u.userType === "EMPLOYEE" && u.mfaRequired && !u.totpEnabled;

// Roles that handle money, people data or system access. New installations require two-step verification for these by default.
export const SENSITIVE_ROLE_KEYS = ["SUPER_ADMIN", "CEO", "FINANCE_MANAGER", "ACCOUNTANT", "HR_MANAGER", "HR_COORDINATOR"] as const;

export type SecurityFinding = { id: string; level: "ok" | "warn" | "fail"; title: string; detail: string };

export function secretStrength(secret: string | undefined): SecurityFinding {
  if (!secret) return { id: "secret", level: "fail", title: "Session secret", detail: "SESSION_SECRET is not set. Sessions and encrypted fields are not protected." };
  if (secret.length < 32) return { id: "secret", level: "fail", title: "Session secret", detail: `SESSION_SECRET is only ${secret.length} characters. Use at least 32 random characters.` };
  if (/change[-_ ]?me|secret|password|example|dev/i.test(secret)) return { id: "secret", level: "warn", title: "Session secret", detail: "SESSION_SECRET looks like a placeholder. Replace it with random characters before going live." };
  return { id: "secret", level: "ok", title: "Session secret", detail: "Set, long enough, and not an obvious placeholder." };
}
