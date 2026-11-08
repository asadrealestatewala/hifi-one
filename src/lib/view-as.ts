// "View as role": a real Super Admin can look at the system as another staff role sees it. The preview is of a role, not of a person:
// the Super Admin keeps their own identity (audit entries, "my" records), but the permissions they hold while previewing are
// the role's permissions, limited to what the Super Admin really has, so a preview can never grant more than their real access.
// Pure functions so the rules are easy to test; the cookie and the database lookups live in auth.ts.

export const VIEW_AS_COOKIE = "hifi_view_as";

// Portal roles have no staff permissions and belong to people bound to a client or vendor record, so they cannot be previewed here.
const NOT_PREVIEWABLE = new Set(["SUPER_ADMIN", "CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"]);

export const canPreviewRole = (roleKey: string) => !NOT_PREVIEWABLE.has(roleKey);

export function previewPermissions<T extends string>(real: ReadonlySet<T>, role: Iterable<T>): Set<T> {
  const out = new Set<T>();
  for (const p of role) if (real.has(p)) out.add(p);
  return out;
}
