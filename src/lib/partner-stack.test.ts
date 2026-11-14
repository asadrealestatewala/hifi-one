import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLE_DEFS } from "./permissions";
import { cleanDuration, cleanRate, certificateStatus, certificateValidityDays, durationLabel, linkedInAddUrl, linkedInShareUrl, newPublicId, newReferralCode, parsePartnerId, partnerId } from "./partner-stack";
import { CERTIFICATE_KINDS, certificatePdf, isCertificateKind } from "./partner-certificate-pdf";
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

describe("the Partner ID", () => {
  it("is shown as HPS- and four or more digits, and search understands every way of typing it", () => {
    expect(partnerId(1)).toBe("HPS-0001");
    expect(partnerId(12345)).toBe("HPS-12345");
    for (const q of ["HPS-0012", "hps-12", "HPS12", "12", " 0012 "]) expect(parsePartnerId(q), q).toBe(12);
    for (const q of ["", "Ayesha", "HPS-AB12-CD34-EF", "HP-29SX9DV4"]) expect(parsePartnerId(q), q).toBeNull();
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
    const bytes = await certificatePdf({ publicId: "HPS-ABCD-EFGH-JK", partnerId: "HPS-0001", partnerName: "Ayesha Khan", solutionName: "Agentify ERP", partnerType: "Reseller Partner", issuedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000 * 30), verifyUrl: "https://hifimarketing.co/partners/verify/HPS-ABCD-EFGH-JK", company: "Hifi", kind: "AUTHORISATION" });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
    const urdu = await certificatePdf({ publicId: "HPS-ABCD-EFGH-JK", partnerId: "HPS-0001", partnerName: "عائشہ", solutionName: "Pharmivo", partnerType: "Referral Partner", issuedAt: new Date(), expiresAt: new Date(), verifyUrl: "https://x.test/v", company: "Hifi", kind: "TRAINING" });
    expect(urdu.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("training and certificate of authorisations", () => {
  const base = { publicId: "HPS-ABCD-EFGH-JK", partnerId: "HPS-0012", partnerName: "A Very Long Partner Company Name (Private) Limited of Lahore", solutionName: "Agentify ERP", partnerType: "Exclusive Sales Partner", issuedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000 * 30), verifyUrl: "https://hifimarketing.co/partners/verify/HPS-ABCD-EFGH-JK", company: "Hifi Marketing and Technologies" };
  it("renders both kinds as a one-page PDF, with and without a signatory, and training without an expiry", async () => {
    for (const d of CERTIFICATE_KINDS) {
      for (const signatoryName of ["", "Asad B Zaman"]) {
        const bytes = await certificatePdf({ ...base, kind: d.key, expiresAt: d.key === "TRAINING" ? null : base.expiresAt, signatoryName, signatoryTitle: "Head of Partnerships" });
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        expect(bytes.toString("latin1").match(/\/Type \/Page\b/g)?.length, `${d.key} stays on one page`).toBe(1);
      }
    }
  });
  it("knows only the two kinds", () => {
    expect(isCertificateKind("TRAINING")).toBe(true);
    expect(isCertificateKind("AUTHORISATION")).toBe(true);
    expect(isCertificateKind("modern")).toBe(false);
  });
  it("a training certificate never expires; an official one does", () => {
    const now = new Date();
    expect(certificateStatus({ status: "ACTIVE", expiresAt: null }, now)).toBe("VALID");
    expect(certificateStatus({ status: "REVOKED", expiresAt: null }, now)).toBe("REVOKED");
    expect(certificateStatus({ status: "ACTIVE", expiresAt: new Date(now.getTime() - 1) }, now)).toBe("EXPIRED");
  });
});

describe("LinkedIn links", () => {
  const p = { kind: "AUTHORISATION", solutionName: "Pharmivo", company: "Hifi Marketing and Technologies", issuedAt: new Date("2026-11-14T00:00:00Z"), publicId: "HPS-ABCD-EFGH-JK" };
  it("fills LinkedIn's add-certification form with the name, issuer, issue month, ID and verify link, and no expiry", () => {
    const u = new URL(linkedInAddUrl(p));
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/profile/add");
    expect(u.searchParams.get("startTask")).toBe("CERTIFICATION_NAME");
    expect(u.searchParams.get("name")).toBe("Hifi Partner Stack: Authorised Partner, Pharmivo");
    expect(u.searchParams.get("organizationName")).toBe("Hifi Marketing and Technologies");
    expect(u.searchParams.get("issueYear")).toBe("2026");
    expect(u.searchParams.get("issueMonth")).toBe("11");
    expect(u.searchParams.get("certId")).toBe("HPS-ABCD-EFGH-JK");
    expect(u.searchParams.get("certUrl")).toMatch(/\/partners\/verify\/HPS-ABCD-EFGH-JK$/);
    expect(u.searchParams.has("expirationYear")).toBe(false);
  });
  it("uses the company page number when it is a number, and ignores anything else", () => {
    expect(new URL(linkedInAddUrl({ ...p, linkedInCompanyId: "12345678" })).searchParams.get("organizationId")).toBe("12345678");
    const bad = new URL(linkedInAddUrl({ ...p, linkedInCompanyId: "javascript:alert(1)" }));
    expect(bad.searchParams.has("organizationId")).toBe(false);
    expect(bad.searchParams.get("organizationName")).toBe("Hifi Marketing and Technologies");
  });
  it("names a training certificate as training", () => {
    expect(new URL(linkedInAddUrl({ ...p, kind: "TRAINING" })).searchParams.get("name")).toBe("Hifi Partner Stack: Pharmivo Partner Training");
  });
  it("shares the public verify link", () => {
    expect(new URL(linkedInShareUrl("HPS-ABCD-EFGH-JK")).searchParams.get("url")).toMatch(/\/partners\/verify\/HPS-ABCD-EFGH-JK$/);
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
