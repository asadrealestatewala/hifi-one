import { describe, expect, it } from "vitest";
import { IdentityError, identityState, nameKey, normalizeIdNumber, payoutState, seal, titleMatches, unseal, validatePayoutAccount } from "./partner-identity";

const SECRET = "s".repeat(40);
const DAY = 86_400_000;

describe("ID numbers", () => {
  it("writes CNIC, NICOP and SSN in their standard form", () => {
    expect(normalizeIdNumber("CNIC", "3520212345671")).toBe("35202-1234567-1");
    expect(normalizeIdNumber("NICOP", " 35202-1234567-1 ")).toBe("35202-1234567-1");
    expect(normalizeIdNumber("SSN", "123 45 6789")).toBe("123-45-6789");
    expect(normalizeIdNumber("PASSPORT", "ab 1234567")).toBe("AB1234567");
  });
  it("refuses numbers of the wrong shape", () => {
    expect(() => normalizeIdNumber("CNIC", "35202-123456-1")).toThrow(IdentityError);
    expect(() => normalizeIdNumber("SSN", "12-3456")).toThrow(/9-digit/);
    expect(() => normalizeIdNumber("PASSPORT", "A1")).toThrow(/passport/i);
  });
});

describe("encryption of sensitive values", () => {
  it("round-trips, differs every time, and fails closed with the wrong key", () => {
    const a = seal("35202-1234567-1", SECRET);
    const b = seal("35202-1234567-1", SECRET);
    expect(a).not.toBe(b);
    expect(a).not.toContain("35202");
    expect(unseal(a, SECRET)).toBe("35202-1234567-1");
    expect(unseal(a, "t".repeat(40))).toBeNull();
  });
  it("refuses to store anything without a proper server secret", () => {
    expect(() => seal("x", "short")).toThrow(/SESSION_SECRET/);
  });
});

describe("payout account titles", () => {
  it("match a verified name regardless of case, punctuation, titles and company suffixes", () => {
    expect(nameKey("Mr. Muhammad  Ali")).toBe("ali muhammad");
    expect(titleMatches("MUHAMMAD ALI", ["Muhammad Ali", null])).toBe(true);
    expect(titleMatches("M/S Bright Schools (Pvt.) Ltd.", ["Muhammad Ali", "Bright Schools Private Limited"])).toBe(true);
    expect(titleMatches("Ali Traders", ["Muhammad Ali"])).toBe(false);
    expect(titleMatches("Muhammad Ali", [])).toBe(false);
  });
  it("check the account field for each method", () => {
    expect(validatePayoutAccount("BANK", "pk36 scbl 0000 0011 2345 6702")).toBe("PK36SCBL0000001123456702");
    expect(() => validatePayoutAccount("BANK", "PK36SCBL00000011")).toThrow(/24 characters/);
    expect(validatePayoutAccount("JAZZCASH", "+92 300 1234567")).toBe("03001234567");
    expect(() => validatePayoutAccount("EASYPAISA", "12345")).toThrow(/mobile number/);
    expect(validatePayoutAccount("PAYPAL", "Sara@Mail.Test")).toBe("sara@mail.test");
    expect(() => validatePayoutAccount("PAYPAL", "sara")).toThrow(/email/);
    expect(validatePayoutAccount("OTHER", "payoneer 998877")).toBe("payoneer 998877");
  });
});

describe("states", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  it("a payout account is held 48 hours and waits for approval when the title differs", () => {
    const base = { removedAt: null, titleMatches: true, approvedAt: null, usableFrom: new Date(now.getTime() + DAY) };
    expect(payoutState(base, now)).toBe("ON_HOLD");
    expect(payoutState({ ...base, usableFrom: new Date(now.getTime() - 1) }, now)).toBe("READY");
    expect(payoutState({ ...base, titleMatches: false, usableFrom: new Date(0) }, now)).toBe("NEEDS_APPROVAL");
    expect(payoutState({ ...base, titleMatches: false, approvedAt: now, usableFrom: new Date(0) }, now)).toBe("READY");
    expect(payoutState({ ...base, removedAt: now }, now)).toBe("REMOVED");
  });
  it("a verified identity becomes due for its yearly re-check", () => {
    expect(identityState(null, now)).toBe("NOT_SUBMITTED");
    expect(identityState({ status: "VERIFIED", recheckDueAt: new Date(now.getTime() + DAY) }, now)).toBe("VERIFIED");
    expect(identityState({ status: "VERIFIED", recheckDueAt: now }, now)).toBe("RECHECK_DUE");
    expect(identityState({ status: "REJECTED", recheckDueAt: null }, now)).toBe("REJECTED");
  });
});
