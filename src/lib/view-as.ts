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

// ---------- View as a person ----------
// A Super Admin can open one person's own view (staff, client, vendor, partner or any other sign-in) to see what they see. It is read-only:
// the middleware refuses every request that changes data while the cookie is present. The cookie is signed and tied to the Super Admin, so
// the middleware only needs to see that it exists (a forged one would only make that browser read-only).
export const VIEW_AS_USER_COOKIE = "hifi_view_as_user";
export const VIEW_AS_USER_HOURS = 2;

// Nobody previews another Super Admin or themselves, and a switched-off account has no view to show.
export const canViewAsUser = (adminId: string, target: { id: string; active: boolean; isSuperAdmin: boolean }) => target.active && !target.isSuperAdmin && target.id !== adminId;

// Pages and routes that hold secrets or other people's private messages. They stay closed while looking at someone's view, whatever that person may open.
const CLOSED_PREFIXES = ["/account/password", "/account/security", "/chat", "/api/chat"];
export const isClosedWhileViewing = (pathname: string) => CLOSED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

// The only request that may change something while viewing: ending the view.
export const isEndViewRequest = (pathname: string) => pathname === "/view-as/stop";
export const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Where a person's own view starts
export const homePathForView = (userType: string) => (userType === "CLIENT" ? "/portal" : userType === "VENDOR" ? "/vendor" : userType === "PARTNER" ? "/partner" : "/dashboard");
