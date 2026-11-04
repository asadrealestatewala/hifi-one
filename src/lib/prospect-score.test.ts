import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, RULE_SERVICE, SERVICES, mergeWeights, scoreProspect, type RuleId, type ScoreInput } from "./prospect-score";

const NOW = new Date("2026-11-04T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const goodCheck = { status: "DONE", reachable: true, https: true, hasTitle: true, hasMetaDescription: true, hasAnalytics: true, hasGtm: false, hasMetaPixel: true, hasContactForm: true, hasWhatsapp: true, lowConfidence: false, mobileScore: 95, seoScore: 95 };
const goodSocial = { facebookUrl: "https://www.facebook.com/x", status: "OK", followers: 9000, lastPostAt: day(2) };
// A business with nothing wrong anywhere
const strong = (over: Partial<ScoreInput> = {}): ScoreInput => ({ name: "Smile Dental", hasWebsite: true, rating: 4.7, ratingCount: 200, check: goodCheck, social: goodSocial, now: NOW, ...over });
const ids = (s: ReturnType<typeof scoreProspect>) => s.reasons.map((r) => r.id).sort();
const pts = (s: ReturnType<typeof scoreProspect>, id: RuleId) => s.reasons.find((r) => r.id === id)?.points ?? 0;

describe("a business with nothing to fix", () => {
  it("scores zero, has no top service and says so in the pitch", () => {
    const s = scoreProspect(strong());
    expect(s).toMatchObject({ score: 0, band: "WEAK", topService: null, reasons: [], services: [], missing: [] });
    expect(s.pitch).toMatch(/nothing obvious to fix/);
  });
});

describe("each rule", () => {
  it("no website: the biggest single reason, for website development", () => {
    const s = scoreProspect(strong({ hasWebsite: false, check: null, social: null }));
    expect(ids(s)).toEqual(["NO_WEBSITE"]);
    expect(s.score).toBe(DEFAULT_WEIGHTS.NO_WEBSITE);
    expect(s.topService).toBe("WEBSITE");
    expect(s.missing).toEqual(["Facebook page not looked for yet"]);
  });
  it("a website that cannot be reached counts as down, and gets no page-level findings", () => {
    const s = scoreProspect(strong({ check: { ...goodCheck, reachable: false, https: null, hasAnalytics: null, mobileScore: null, seoScore: null } as never, social: null }));
    expect(ids(s)).toEqual(["SITE_DOWN"]);
    expect(s.topService).toBe("WEBSITE");
  });
  it("a website that refused our check is unknown, not weak", () => {
    const s = scoreProspect(strong({ check: { ...goodCheck, reachable: null } as never, social: null }));
    expect(s.reasons).toEqual([]);
    expect(s.missing).toContain("Website refused our check, so its page could not be read");
  });
  it("not checked, queued, running or failed is unknown", () => {
    for (const check of [null, { ...goodCheck, status: "QUEUED" }, { ...goodCheck, status: "RUNNING" }, { ...goodCheck, status: "FAILED" }]) {
      const s = scoreProspect(strong({ check: check as never, social: null }));
      expect(s.reasons, JSON.stringify(check)).toEqual([]);
      expect(s.missing).toContain("Website not checked yet");
    }
  });
  it("page findings: https, title, description, analytics, pixel, form, WhatsApp", () => {
    const s = scoreProspect(strong({ check: { ...goodCheck, https: false, hasTitle: false, hasMetaDescription: false, hasAnalytics: false, hasMetaPixel: false, hasContactForm: false, hasWhatsapp: false } as never }));
    expect(ids(s)).toEqual(["NO_ANALYTICS", "NO_CONTACT_FORM", "NO_HTTPS", "NO_META_DESCRIPTION", "NO_META_PIXEL", "NO_TITLE", "NO_WHATSAPP"]);
    expect(s.services.map((x) => x.service).sort()).toEqual(["ADS", "CRM", "SEO", "WEBSITE"]);
  });
  it("speed and SEO: full points when poor, half when middling, none when good, noted when missing", () => {
    expect(pts(scoreProspect(strong({ check: { ...goodCheck, mobileScore: 30, seoScore: 40 } as never })), "SLOW_MOBILE")).toBe(15);
    expect(pts(scoreProspect(strong({ check: { ...goodCheck, mobileScore: 70, seoScore: 80 } as never })), "SLOW_MOBILE")).toBe(7.5);
    expect(pts(scoreProspect(strong({ check: { ...goodCheck, mobileScore: 70, seoScore: 80 } as never })), "LOW_SEO")).toBe(6);
    expect(pts(scoreProspect(strong({ check: { ...goodCheck, mobileScore: 90, seoScore: 90 } as never })), "SLOW_MOBILE")).toBe(0);
    expect(scoreProspect(strong({ check: { ...goodCheck, mobileScore: null } as never })).missing).toContain("Speed score not available");
  });
  it("a Tag Manager hides the pixel, so a missing pixel is not counted against them", () => {
    const s = scoreProspect(strong({ check: { ...goodCheck, hasMetaPixel: false, hasGtm: true } as never }));
    expect(ids(s)).toEqual([]);
  });
  it("a page built in the browser counts the tags and forms we could not see for half", () => {
    const s = scoreProspect(strong({ check: { ...goodCheck, hasAnalytics: false, hasContactForm: false, lowConfidence: true } as never }));
    expect(pts(s, "NO_ANALYTICS")).toBe(4);
    expect(pts(s, "NO_CONTACT_FORM")).toBe(4);
  });
  it("facebook: none found on a read website, few followers, stale posts", () => {
    expect(ids(scoreProspect(strong({ social: null })))).toEqual(["NO_FACEBOOK"]);
    expect(ids(scoreProspect(strong({ social: { ...goodSocial, followers: 120, lastPostAt: day(200) } })))).toEqual(["FEW_FOLLOWERS", "STALE_FACEBOOK"]);
    const mid = scoreProspect(strong({ social: { ...goodSocial, followers: 1500, lastPostAt: day(45) } }));
    expect(pts(mid, "FEW_FOLLOWERS")).toBe(4);
    expect(pts(mid, "STALE_FACEBOOK")).toBe(6);
    expect(mid.reasons.find((r) => r.id === "STALE_FACEBOOK")?.text).toBe("Facebook page last posted 45 days ago");
  });
  it("facebook found but numbers not fetched, or fetched without a date, is unknown", () => {
    expect(scoreProspect(strong({ social: { ...goodSocial, status: "NOT_FETCHED", followers: null, lastPostAt: null } })).missing).toEqual(["Facebook numbers not fetched yet"]);
    expect(scoreProspect(strong({ social: { ...goodSocial, lastPostAt: null } })).missing).toEqual(["Facebook last post date not available"]);
    expect(scoreProspect(strong({ social: { ...goodSocial, status: "FAILED", followers: null, lastPostAt: null } })).reasons).toEqual([]);
  });
  it("google listing: few or no reviews, low rating", () => {
    expect(pts(scoreProspect(strong({ ratingCount: 3 })), "FEW_REVIEWS")).toBe(8);
    expect(pts(scoreProspect(strong({ ratingCount: 30 })), "FEW_REVIEWS")).toBe(4);
    expect(pts(scoreProspect(strong({ ratingCount: 50 })), "FEW_REVIEWS")).toBe(0);
    expect(scoreProspect(strong({ ratingCount: null, rating: null })).reasons.map((r) => r.text)).toEqual(["No Google reviews"]);
    expect(scoreProspect(strong({ rating: 3.6 })).reasons.map((r) => r.text)).toEqual(["Rated 3.6 out of 5 on Google"]);
    expect(scoreProspect(strong({ ratingCount: 1 })).reasons[0].text).toBe("Only 1 Google review");
  });
  it("every rule belongs to one of the six services", () => {
    for (const id of Object.keys(DEFAULT_WEIGHTS) as RuleId[]) expect(Object.keys(SERVICES)).toContain(RULE_SERVICE[id]);
    expect(Object.keys(SERVICES)).toHaveLength(6);
  });
});

describe("the total", () => {
  const worst = strong({ rating: 3.2, ratingCount: 2, check: { ...goodCheck, https: false, hasTitle: false, hasMetaDescription: false, hasAnalytics: false, hasMetaPixel: false, hasContactForm: false, hasWhatsapp: false, mobileScore: 20, seoScore: 30 } as never, social: { ...goodSocial, followers: 10, lastPostAt: day(400) } });
  it("never passes 100", () => {
    const s = scoreProspect(worst);
    expect(s.reasons.reduce((n, r) => n + r.points, 0)).toBeGreaterThan(100);
    expect(s.score).toBe(100);
    expect(s.band).toBe("STRONG");
  });
  it("sums the reasons, lists the biggest first and picks the top service by total points", () => {
    const s = scoreProspect(strong({ check: { ...goodCheck, hasAnalytics: false, hasMetaPixel: false, hasContactForm: false } as never }));
    expect(s.score).toBe(24);
    expect(s.reasons.map((r) => r.points)).toEqual([8, 8, 8]);
    expect(s.services[0]).toMatchObject({ service: "ADS", points: 16 });
    expect(s.topService).toBe("ADS");
  });
  it("breaks ties between services in a fixed order, so the answer never flips", () => {
    const s = scoreProspect(strong({ check: { ...goodCheck, hasContactForm: false, hasWhatsapp: false } as never }));
    expect(s.services.map((x) => x.service)).toEqual(["CRM"]);
    const t = scoreProspect(strong({ check: { ...goodCheck, hasContactForm: false } as never, ratingCount: 3 }));
    expect(t.services.map((x) => x.service)).toEqual(["BRAND", "CRM"]);
  });
  it("bands the score", () => {
    const noSite = strong({ hasWebsite: false, check: null, social: null });
    expect(scoreProspect(noSite).band).toBe("GOOD"); // 35
    expect(scoreProspect({ ...noSite, ratingCount: 3, rating: 3 }).score).toBe(51);
    expect(scoreProspect(strong({ check: { ...goodCheck, hasContactForm: false, hasWhatsapp: false } as never, ratingCount: 3 })).band).toBe("SOME"); // 21
    expect(scoreProspect(strong({ ratingCount: 3 })).band).toBe("WEAK");
  });
  it("is the same for the same facts", () => {
    expect(scoreProspect(worst)).toEqual(scoreProspect(worst));
  });
});

describe("weights", () => {
  it("can be changed per rule, and are clamped, rounded and defaulted", () => {
    expect(mergeWeights({ NO_WEBSITE: 10 }).NO_WEBSITE).toBe(10);
    expect(mergeWeights({ NO_WEBSITE: -5 }).NO_WEBSITE).toBe(0);
    expect(mergeWeights({ NO_WEBSITE: 999 }).NO_WEBSITE).toBe(50);
    expect(mergeWeights({ NO_WEBSITE: NaN }).NO_WEBSITE).toBe(DEFAULT_WEIGHTS.NO_WEBSITE);
    expect(mergeWeights({ NO_WEBSITE: 7.6 }).NO_WEBSITE).toBe(8);
    expect(mergeWeights({}).NO_TITLE).toBe(DEFAULT_WEIGHTS.NO_TITLE);
  });
  it("change the score, and a zero weight removes the reason", () => {
    const input = strong({ hasWebsite: false, check: null, social: null });
    expect(scoreProspect(input, { NO_WEBSITE: 50 }).score).toBe(50);
    expect(scoreProspect(input, { NO_WEBSITE: 0 }).reasons).toEqual([]);
  });
});

describe("the pitch note", () => {
  it("names the business, the lead service, the findings, why it matters, other services and what is unknown", () => {
    const s = scoreProspect(strong({ hasWebsite: false, check: null, social: null, ratingCount: 3 }));
    expect(s.pitch).toContain("Smile Dental:");
    expect(s.pitch).toContain("Lead with Website development.");
    expect(s.pitch).toContain("- No website at all");
    expect(s.pitch).toContain("- Only 3 Google reviews");
    expect(s.pitch).toContain(`Why it matters: ${SERVICES.WEBSITE.angle}`);
    expect(s.pitch).toContain("Also worth raising: Brand building.");
    expect(s.pitch).toContain("Not known yet: Facebook page not looked for yet.");
  });
  it("lists at most five findings", () => {
    const s = scoreProspect(strong({ rating: 3.2, ratingCount: 2, check: { ...goodCheck, https: false, hasTitle: false, hasMetaDescription: false, hasAnalytics: false, hasMetaPixel: false, hasContactForm: false, hasWhatsapp: false, mobileScore: 20, seoScore: 30 } as never }));
    expect(s.pitch.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(5);
  });
});
