import { describe, expect, it } from "vitest";
import { buildSlots, estimateTextCost, planPrompt, platformsFor, postingDays } from "./content-ai";

describe("posting days", () => {
  it("skips Sundays and days before the start date", () => {
    const d = postingDays("2026-12");
    expect(d).toHaveLength(27); // 31 days, 4 Sundays
    expect(d).not.toContain("2026-12-06");
    expect(postingDays("2026-12", "2026-12-22")[0]).toBe("2026-12-22");
  });
});

describe("slots", () => {
  const counts = { REEL: 8, LONG_VIDEO: 2, STATIC_CREATIVE: 12 };
  it("makes exactly the promised number of each type, on distinct spread dates in the month", () => {
    const s = buildSlots({ month: "2026-12", counts, platforms: ["INSTAGRAM", "YOUTUBE", "LINKEDIN"] });
    expect(s).toHaveLength(22);
    expect(s.filter((x) => x.postType === "REEL")).toHaveLength(8);
    expect(s.filter((x) => x.postType === "VIDEO")).toHaveLength(2);
    expect(s.filter((x) => x.postType === "STATIC")).toHaveLength(12);
    expect(s.every((x) => x.date.startsWith("2026-12"))).toBe(true);
    expect(s[0].date <= s[21].date).toBe(true);
    expect(new Set(s.map((x) => x.date)).size).toBeGreaterThan(15);
  });
  it("does not bunch one type together", () => {
    const s = buildSlots({ month: "2026-12", counts, platforms: [] });
    const types = s.map((x) => x.postType);
    let run = 1, longest = 1;
    for (let i = 1; i < types.length; i++) { run = types[i] === types[i - 1] ? run + 1 : 1; longest = Math.max(longest, run); }
    expect(longest).toBeLessThanOrEqual(3);
  });
  it("starts from today in the current month and handles zero or too-late months", () => {
    expect(buildSlots({ month: "2026-12", counts: { REEL: 3, LONG_VIDEO: 0, STATIC_CREATIVE: 0 }, platforms: [], from: "2026-12-28" }).every((x) => x.date >= "2026-12-28")).toBe(true);
    expect(buildSlots({ month: "2026-12", counts: { REEL: 0, LONG_VIDEO: 0, STATIC_CREATIVE: 0 }, platforms: [] })).toEqual([]);
    expect(() => buildSlots({ month: "2026-12", counts: { REEL: 1, LONG_VIDEO: 0, STATIC_CREATIVE: 0 }, platforms: [], from: "2027-01-01" })).toThrow(/no days left/);
  });
});

describe("platforms", () => {
  it("uses the client's platforms that suit the post type, with safe fallbacks", () => {
    expect(platformsFor("REEL", ["INSTAGRAM", "LINKEDIN", "TIKTOK"])).toEqual(["INSTAGRAM", "TIKTOK"]);
    expect(platformsFor("VIDEO", ["INSTAGRAM"])).toEqual(["INSTAGRAM"]);
    expect(platformsFor("STATIC", [])).toEqual(["INSTAGRAM", "FACEBOOK"]);
    expect(platformsFor("STATIC", ["NOPE"])).toEqual(["INSTAGRAM", "FACEBOOK"]);
  });
});

describe("prompt and cost", () => {
  it("includes the client's facts, the brief and every slot", () => {
    const slots = buildSlots({ month: "2026-12", counts: { REEL: 1, LONG_VIDEO: 0, STATIC_CREATIVE: 1 }, platforms: ["INSTAGRAM"] });
    const t = planPrompt({ clientName: "Acme", clientType: "MARKETING", month: "2026-12", monthLabel: "December 2026", profile: { about: "Sells shoes", brandVoice: "Warm", audience: null, topics: null, avoid: "Competitors", languages: null, hashtagRules: null }, monthBrief: "Winter sale on the 10th", slots });
    expect(t).toContain("Acme"); expect(t).toContain("Sells shoes"); expect(t).toContain("Winter sale on the 10th"); expect(t).toContain("Slot 0"); expect(t).toContain("Slot 1"); expect(t).toContain("Competitors");
  });
  it("estimates cost from tokens", () => { expect(estimateTextCost({ inputTokens: 5000, outputTokens: 10000 })).toBeCloseTo(0.22, 3); });
});
