// Sign-in accepts the registered email or the registered contact number. Both are turned into the exact stored
// form, so the same account is found however the person types it. A phone number is only an identifier: the
// password (and two-step code, when on) is always required.
import { StaffError, normalizeStaffPhone } from "./staff";

export type LoginIdentifier = { kind: "email"; value: string } | { kind: "phone"; value: string };

export function parseLoginIdentifier(raw: string): LoginIdentifier | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.includes("@")) {
    const email = v.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: "email", value: email } : null;
  }
  try {
    const phone = normalizeStaffPhone(v);
    return phone ? { kind: "phone", value: phone } : null;
  } catch (e) {
    if (e instanceof StaffError) return null;
    throw e;
  }
}
