import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLE_DEFS } from "./permissions";
import { cleanDuration, cleanRate, certificateStatus, certificateValidityDays, durationLabel, newPublicId, newReferralCode } from "./partner-stack";
import { certificatePdf } from "./partner-certificate-pdf";
import { sameSite } from "./same-site";

describe("certificate validity", () => {
  const s = { cert_expiry_days: "30", "cert_expiry_days:AGENTIFY": "60", "cert_expiry_days:PHARMIVO": "" };
  it("uses the partner's own days first, then the Solution's, then the global default", () => {
    expect(certificateValidityDays(s, "AGENTIFY", 10)).toBe(10);
    expect(certificateValidityDays(s, "AGENTIFY", null)).toBe(60);
    expect(certificateValidityDays(s, "VELOCITY", null)).toBe(30);
    expect(certificateValidityDays(s, "PHARMIVO", null)).toBe(30);
  });
  it("falls back to 30 when the setting is missing or broken", () => {
    expect(certificateValidityDays({}, "X", null)).toBe(30);
    expect(certificateValidityDays({ cert_expiry_days: "abc" }, "X", null)).toBe(30);
  });
});

describe("terms validation", () => {
  it("accepts rates from 0 to 50 with two decimals", () => {
    expect(cleanRate("30")).toBe("30");
    expect(cleanRate("12.5%")).toBe("12.5");
    for (const bad of ["", "51", "-1", "1.234", "abc"]) expect(() => cleanRate(bad)).toThrow();
  });
  it("reads lifetime as null and months as a number", () => {
    expect(cleanDuration("")).toBeNull();
    expect(cleanDuration("Lifetime")).toBeNull();
    expect(cleanDuration("36")).toBe(36);
    for (const bad of ["0", "601", "1.5", "x"]) expect(() => cleanDuration(bad)).toThrow();
    expect(durationLabel(null)).toMatch(/Lifetime/);
    expect(durationLabel(12)).toBe("1 year");
    expect(durationLabel(36)).toBe("3 years");
    expect(durationLabel(18)).toBe("18 months");
  });
});

describe("certificate ids and status", () => {
  it("makes unguessable-looking, well-formed ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newPublicId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^HPS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    expect(newReferralCode()).toMatch(/^HP-[A-Z0-9]{8}$/);
  });
  it("works status out from revocation and expiry", () => {
    const now = new Date("2026-11-14T00:00:00Z");
    expect(certificateStatus({ status: "ACTIVE", expiresAt: new Date("2026-11-15T00:00:00Z") }, now)).toBe("VALID");
    expect(certificateStatus({ status: "ACTIVE", expiresAt: new Date("2026-11-14T00:00:00Z") }, now)).toBe("EXPIRED");
    expect(certificateStatus({ status: "REVOKED", expiresAt: new Date("2027-01-01T00:00:00Z") }, now)).toBe("REVOKED");
  });
});

describe("the certificate PDF", () => {
  it("renders a PDF with a QR code for any name", async () => {
    const bytes = await certificatePdf({ publicId: "HPS-ABCD-EFGH-JK", partnerName: "Ayesha Khan", solutionName: "Agentify ERP", partnerType: "Reseller Partner", issuedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000 * 30), verifyUrl: "https://hifimarketing.co/partners/verify/HPS-ABCD-EFGH-JK", company: "Hifi" });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
    const urdu = await certificatePdf({ publicId: "HPS-ABCD-EFGH-JK", partnerName: "عائشہ", solutionName: "Pharmivo", partnerType: "Referral Partner", issuedAt: new Date(), expiresAt: new Date(), verifyUrl: "https://x.test/v", company: "Hifi" });
    expect(urdu.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("permissions and the Partner Manager role", () => {
  it("registers both permissions and gives the Partner Manager only the manage one", () => {
    expect(ALL_PERMISSIONS).toContain("partners.manage");
    expect(ALL_PERMISSIONS).toContain("partners.settings");
    const pm = ROLE_DEFS.find((r) => r.key === "PARTNER_MANAGER")!;
    expect(pm.permissions).toContain("partners.manage");
    expect(pm.permissions).not.toContain("partners.settings");
    const sa = ROLE_DEFS.find((r) => r.key === "SUPER_ADMIN")!;
    expect(sa.permissions).toBe("ALL");
    for (const r of ROLE_DEFS.filter((x) => x.key !== "PARTNER_MANAGER" && x.key !== "SUPER_ADMIN" && x.permissions !== "ALL")) expect(r.permissions, r.key).not.toContain("partners.manage");
  });
  it("same-site check still blocks a foreign origin on the form endpoints", () => {
    expect(sameSite({ headers: { get: (n: string) => ({ origin: "https://evil.test", host: "hifimarketing.co" } as Record<string, string>)[n] ?? null } })).toBe(false);
  });
});
