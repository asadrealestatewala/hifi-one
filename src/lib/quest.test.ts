import { describe, expect, it } from "vitest";
import { DEFAULT_QUEST, actCounts, dayKey, dayStartInstant, levelFor, parseSettings, readFields, readHolidays, resolveConfig, streakFor, tallyByDay, totalXp } from "./quest";

const cfg = DEFAULT_QUEST;
const at = (iso: string) => new Date(iso);

describe("quest rules", () => {
  it("uses Pakistan calendar days, not UTC", () => {
    expect(dayKey(at("2026-11-09T20:30:00Z"), "Asia/Karachi")).toBe("2026-11-10"); // 1:30 AM next morning in Karachi
    expect(dayStartInstant("2026-11-10", "Asia/Karachi").toISOString()).toBe("2026-11-09T19:00:00.000Z");
  });

  it("short notes earn nothing; calls always count", () => {
    expect(actCounts({ at: new Date(), kind: "NOTE", body: "ok" }, cfg)).toBe(false);
    expect(actCounts({ at: new Date(), kind: "NOTE", body: "Spoke to owner, wants a demo Friday" }, cfg)).toBe(true);
    expect(actCounts({ at: new Date(), kind: "CALL", body: null }, cfg)).toBe(true);
    expect(actCounts({ at: new Date(), kind: "SYSTEM", body: null }, cfg)).toBe(false);
  });

  it("caps contact/activity/visit XP per day but pays verified calls and conversions in full", () => {
    const d = at("2026-11-09T06:00:00Z");
    const many = tallyByDay(cfg, Array(100).fill(d), [], []); // 100 contacts in one day = 1000 raw XP
    expect(totalXp(cfg, many, 0, 0)).toBe(cfg.dailyXpCap);
    expect(totalXp(cfg, many, 2, 1)).toBe(cfg.dailyXpCap + 2 * cfg.xpVerifiedCall + cfg.xpConversion);
    const spread = tallyByDay(cfg, [d, at("2026-11-10T06:00:00Z")], [], [at("2026-11-10T07:00:00Z")]);
    expect(totalXp(cfg, spread, 0, 0)).toBe(10 + 10 + 5);
  });

  it("makes Legend take months, not days", () => {
    expect(levelFor(cfg, 1010).levelName).toBe("Prospector");
    expect(levelFor(cfg, 9599).level).toBe(4);
    expect(levelFor(cfg, 9600)).toMatchObject({ level: 5, levelName: "Legend", nextLevelAt: null });
    expect(levelFor(cfg, 0)).toMatchObject({ level: 1, levelStartsAt: 0, nextLevelAt: 600 });
  });

  it("streak skips weekends and holidays but breaks on a missed working day", () => {
    // 2026-11-09 is a Monday. Worked Thu 5, Fri 6 (Sat 7 and Sun 8 are the default weekend), Mon 9.
    const day = (k: string) => [k, { contacts: 1, activities: 0, visits: 0 }] as const;
    const days = new Map([day("2026-11-05"), day("2026-11-06"), day("2026-11-09")]);
    expect(streakFor(cfg, [], days, "2026-11-09")).toBe(3);
    expect(streakFor(cfg, [], new Map([day("2026-11-05"), day("2026-11-09")]), "2026-11-09")).toBe(1); // Friday missed
    expect(streakFor(cfg, ["2026-11-06"], new Map([day("2026-11-05"), day("2026-11-09")]), "2026-11-09")).toBe(2); // Friday was a holiday
    expect(streakFor(cfg, [], new Map([day("2026-11-06")]), "2026-11-09")).toBe(1); // nothing yet today does not break it
    expect(streakFor(cfg, [], new Map(), "2026-11-09")).toBe(0);
  });

  it("merges role overrides over the default and ignores damaged values", () => {
    const s = parseSettings({ base: { goalContacts: 8, xpContact: -4, bogus: 1 }, roles: { FIELD: { goalVisits: 40, goalContacts: 2 } }, holidays: ["2026-12-25", "nope"] });
    expect(resolveConfig(s, ["SALES"])).toMatchObject({ goalContacts: 8, xpContact: 10, goalVisits: 0 });
    expect(resolveConfig(s, ["SALES", "FIELD"])).toMatchObject({ goalContacts: 2, goalVisits: 40 });
    expect(s.holidays).toEqual(["2026-12-25"]);
    expect(parseSettings("garbage").holidays).toEqual([]);
  });

  it("validates settings input with plain messages", () => {
    expect(readFields((k) => (k === "goalContacts" ? "7" : ""))).toEqual({ goalContacts: 7 });
    expect(() => readFields((k) => (k === "goalContacts" ? "-1" : ""))).toThrow(/whole number/);
    expect(() => readFields((k) => (k === "dailyXpCap" ? "0" : ""))).toThrow(/Daily XP cap/);
    expect(readHolidays("2026-12-25\n2026-12-25, 2026-03-23")).toEqual(["2026-03-23", "2026-12-25"]);
    expect(() => readHolidays("25/12/2026")).toThrow(/YYYY-MM-DD/);
  });
});
