import { describe, expect, it } from "vitest";
import { FALLBACK_SECONDS, GONE_LIMIT, HARD_MIN_SECONDS, allocateFastLane, backoffSeconds, type PostState, detectPost, growthOver, healthOf, intervalFor, nextState, platformBackoffSeconds, validateTimer } from "./clout-rules";

describe("link detection", () => {
  it.each([
    ["https://www.tiktok.com/@Some.User/video/7282347832857095467?is_from_webapp=1&sender_device=pc", "TIKTOK", "https://www.tiktok.com/@some.user/video/7282347832857095467", "7282347832857095467"],
    ["tiktok.com/@a_b/video/1234567890123/", "TIKTOK", "https://www.tiktok.com/@a_b/video/1234567890123", "1234567890123"],
    ["https://vm.tiktok.com/ZMabc123/", "TIKTOK", "https://vm.tiktok.com/ZMabc123", null],
    ["https://www.tiktok.com/t/ZT8abcdEf/", "TIKTOK", "https://www.tiktok.com/t/ZT8abcdEf", null],
    ["https://www.instagram.com/reel/C-0abcDEF12/?igsh=xyz", "INSTAGRAM", "https://www.instagram.com/reel/C-0abcDEF12", "C-0abcDEF12"],
    ["https://instagram.com/p/CxYz12345Ab", "INSTAGRAM", "https://www.instagram.com/p/CxYz12345Ab", "CxYz12345Ab"],
    ["https://www.instagram.com/someone/reel/CxYz12345Ab/", "INSTAGRAM", "https://www.instagram.com/reel/CxYz12345Ab", "CxYz12345Ab"],
    ["https://www.facebook.com/reel/123456789012345?mibextid=x", "FACEBOOK", "https://www.facebook.com/reel/123456789012345", "123456789012345"],
    ["https://www.facebook.com/watch/?v=123456789012&ref=sharing", "FACEBOOK", "https://www.facebook.com/watch/?v=123456789012", "123456789012"],
    ["https://m.facebook.com/somepage/videos/123456789012/", "FACEBOOK", "https://www.facebook.com/watch/?v=123456789012", "123456789012"],
    ["https://fb.watch/abc-DEF12/", "FACEBOOK", "https://fb.watch/abc-DEF12", null],
  ])("accepts %s", (raw, platform, canonical, id) => {
    expect(detectPost(raw)).toEqual({ platform, canonicalUrl: canonical, externalId: id });
  });
  it("treats the same post with different tracking parameters or capitals as one post", () => {
    expect(detectPost("https://WWW.TikTok.com/@x/video/99999999?a=1")!.canonicalUrl).toBe(detectPost("https://tiktok.com/@x/video/99999999/")!.canonicalUrl);
  });
  it.each([
    "", "hello", "https://youtube.com/watch?v=abcdefghijk", "https://www.tiktok.com/@user", "https://www.instagram.com/someone/", "https://www.facebook.com/somepage",
    "https://evil.com/?u=https://www.tiktok.com/@a/video/123456", "https://www.tiktok.com.evil.com/@a/video/123456", "https://user:pw@www.tiktok.com/@a/video/123456",
    "https://www.tiktok.com:8080/@a/video/123456", "javascript:alert(1)", "https://www.tiktok.com/@a/video/123456 --exec", "--exec=touch /tmp/x",
    "https://www.instagram.com/stories/user/1234567890", "https://www.facebook.com/profile.php?id=123456",
  ])("refuses %j", (raw) => { expect(detectPost(raw)).toBeNull(); });
});

describe("the 60 second minimum", () => {
  it("accepts 60 seconds and anything slower", () => { expect(validateTimer(60)).toBe(60); expect(validateTimer("900")).toBe(900); });
  it.each([59, 30, 0, -5, 60.5, NaN, "abc", null, undefined])("refuses %s", (v) => { expect(() => validateTimer(v)).toThrow(); });
  it("a quota row can raise the minimum but never lower it below 60", () => {
    expect(() => validateTimer(120, 300)).toThrow();
    expect(validateTimer(300, 300)).toBe(300);
    expect(() => validateTimer(30, 10)).toThrow();
    expect(HARD_MIN_SECONDS).toBe(60);
  });
  it("refuses more than a week", () => { expect(() => validateTimer(8 * 86_400)).toThrow(); });
});

describe("fast-lane quota", () => {
  const mk = (id: string, want: number, extra: Partial<{ pinned: boolean; paused: boolean; day: number }> = {}) => ({ id, wantedSeconds: want, pinned: extra.pinned ?? false, paused: extra.paused, createdAt: new Date(2026, 0, extra.day ?? 1) });
  it("gives the fast lane to the first posts up to the quota and drops the rest to 15 minutes", () => {
    const r = allocateFastLane([mk("a", 60, { day: 1 }), mk("b", 60, { day: 2 }), mk("c", 300, { day: 3 })], 2);
    expect(r.find((x) => x.id === "a")).toMatchObject({ fastLane: true, effectiveSeconds: 60, quotaFallback: false });
    expect(r.find((x) => x.id === "b")).toMatchObject({ fastLane: true, effectiveSeconds: 60 });
    expect(r.find((x) => x.id === "c")).toMatchObject({ fastLane: false, effectiveSeconds: FALLBACK_SECONDS, quotaFallback: true });
  });
  it("pinned posts win a place before older ones", () => {
    const r = allocateFastLane([mk("old", 60, { day: 1 }), mk("pin", 60, { day: 9, pinned: true })], 1);
    expect(r.find((x) => x.id === "pin")!.fastLane).toBe(true);
    expect(r.find((x) => x.id === "old")!.quotaFallback).toBe(true);
  });
  it("slow timers never use or need a place, and are never flagged", () => {
    const r = allocateFastLane([mk("a", 900), mk("b", 3600), mk("c", 21600)], 0);
    expect(r.every((x) => !x.fastLane && !x.quotaFallback)).toBe(true);
    expect(r.map((x) => x.effectiveSeconds)).toEqual([900, 3600, 21600]);
  });
  it("paused posts take no place", () => {
    const r = allocateFastLane([mk("p", 60, { paused: true, day: 1 }), mk("a", 60, { day: 2 })], 1);
    expect(r.find((x) => x.id === "a")!.fastLane).toBe(true);
    expect(r.find((x) => x.id === "p")!.fastLane).toBe(false);
  });
  it("a quota of zero sends every fast request to the fallback", () => {
    expect(allocateFastLane([mk("a", 60)], 0)[0]).toMatchObject({ quotaFallback: true, effectiveSeconds: FALLBACK_SECONDS });
  });
});

describe("old posts slow down", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const base = { effectiveSeconds: 60, pinned: false, postedAt: null as Date | null, createdAt: now, lastViewedAt: null as Date | null };
  const age = (d: number) => new Date(now.getTime() - d * 86_400_000);
  it("keeps the chosen interval for a new post", () => { expect(intervalFor({ ...base, createdAt: age(1) }, now)).toBe(60); });
  it("checks at most hourly after 7 days", () => { expect(intervalFor({ ...base, createdAt: age(8) }, now)).toBe(3600); });
  it("checks daily after 30 days", () => { expect(intervalFor({ ...base, createdAt: age(31) }, now)).toBe(86_400); });
  it("uses the post date, not the date it was added", () => { expect(intervalFor({ ...base, postedAt: age(40), createdAt: age(1) }, now)).toBe(86_400); });
  it("pinned posts keep their interval", () => { expect(intervalFor({ ...base, createdAt: age(90), pinned: true }, now)).toBe(60); });
  it("a post someone has open keeps its interval", () => { expect(intervalFor({ ...base, createdAt: age(90), lastViewedAt: new Date(now.getTime() - 30_000) }, now)).toBe(60); });
  it("never goes below the hard minimum", () => { expect(intervalFor({ ...base, effectiveSeconds: 5, createdAt: age(0) }, now)).toBe(60); });
});

describe("deleted-post rule", () => {
  const live: PostState = { status: "LIVE", consecutiveFailures: 0, consecutiveGone: 0 };
  it("marks a post unavailable only on the third not-found in a row", () => {
    let s: PostState = { ...live };
    const a = nextState(s, "gone", 900); expect(a.status).toBe("FAILED"); expect(a.becameUnavailable).toBe(false); s = a;
    const b = nextState(s, "gone", 900); expect(b.status).toBe("FAILED"); expect(b.becameUnavailable).toBe(false); s = b;
    const c = nextState(s, "gone", 900);
    expect(GONE_LIMIT).toBe(3);
    expect(c).toMatchObject({ status: "UNAVAILABLE", becameUnavailable: true, retrySeconds: null });
  });
  it("a good check in between resets the count", () => {
    const a = nextState(live, "gone", 900);
    const ok = nextState(a, "ok", 900);
    expect(ok).toMatchObject({ status: "LIVE", consecutiveGone: 0, consecutiveFailures: 0 });
    expect(nextState(nextState(ok, "gone", 900), "gone", 900).status).toBe("FAILED");
  });
  it("temporary blocks and errors never mark a post deleted, however many there are", () => {
    let s: PostState = { ...live };
    for (let i = 0; i < 50; i++) { const t = nextState(s, "temporary", 900); expect(t.status).toBe("FAILED"); expect(t.becameUnavailable).toBe(false); s = t; }
    expect(s.consecutiveGone).toBe(0);
  });
  it("a temporary failure does not count towards, or erase, the not-found count", () => {
    const a = nextState(live, "gone", 900);
    const t = nextState(a, "temporary", 900);
    expect(t.consecutiveGone).toBe(1);
    expect(nextState(nextState(t, "gone", 900), "gone", 900).status).toBe("UNAVAILABLE");
  });
  it("unavailable and paused posts stay as they are", () => {
    expect(nextState({ status: "UNAVAILABLE", consecutiveFailures: 3, consecutiveGone: 3 }, "ok", 60).status).toBe("UNAVAILABLE");
    expect(nextState({ status: "PAUSED", consecutiveFailures: 0, consecutiveGone: 0 }, "gone", 60).status).toBe("PAUSED");
  });
  it("retries a not-found sooner than the normal interval but never faster than the minimum", () => {
    expect(nextState(live, "gone", 21600).retrySeconds).toBe(600);
    expect(nextState(live, "gone", 60).retrySeconds).toBe(60);
  });
});

describe("backoff", () => {
  it("doubles with each failure and stops at 6 hours", () => {
    expect(backoffSeconds(1, 900)).toBe(1800);
    expect(backoffSeconds(2, 900)).toBe(3600);
    expect(backoffSeconds(20, 900)).toBe(6 * 3600);
  });
  it("pauses a platform only after three refusals in a row, then for longer each time up to an hour", () => {
    expect([1, 2].map(platformBackoffSeconds)).toEqual([0, 0]);
    expect(platformBackoffSeconds(3)).toBe(120);
    expect(platformBackoffSeconds(4)).toBe(240);
    expect(platformBackoffSeconds(30)).toBe(3600);
  });
  it("reports health", () => {
    const now = new Date();
    expect(healthOf({ failStreak: 0, backoffUntil: null }, now)).toBe("OK");
    expect(healthOf({ failStreak: 1, backoffUntil: null }, now)).toBe("DEGRADED");
    expect(healthOf({ failStreak: 3, backoffUntil: null }, now)).toBe("BLOCKED");
    expect(healthOf({ failStreak: 1, backoffUntil: new Date(now.getTime() + 1000) }, now)).toBe("BLOCKED");
  });
});

describe("growth", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const at = (min: number, views: number) => ({ takenAt: new Date(now.getTime() - min * 60_000), views, likes: views / 10, comments: views / 100 });
  it("measures against the last snapshot at or before the start of the window", () => {
    const g = growthOver([at(200, 100), at(70, 400), at(30, 700), at(0, 1000)], now, 3_600_000)!;
    expect(g).toMatchObject({ views: 600, partial: false });
  });
  it("marks growth partial when the post is younger than the window", () => {
    expect(growthOver([at(20, 100), at(0, 150)], now, 86_400_000)).toMatchObject({ views: 50, partial: true });
  });
  it("needs two snapshots", () => { expect(growthOver([at(0, 5)], now, 3_600_000)).toBeNull(); });
});
