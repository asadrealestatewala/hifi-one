import { describe, expect, it } from "vitest";
import { GraphError, autoPlatforms, classify, loginUrl, mediaProblem, pickMedia, signState, verifyState } from "./social-meta";
import { localToUtc } from "./social-time";

const SECRET = "s".repeat(40);

describe("the planned time in company time", () => {
  it("turns Karachi and UTC local times into the right instant", () => {
    expect(localToUtc("2026-12-03", "18:30", "Asia/Karachi").toISOString()).toBe("2026-12-03T13:30:00.000Z");
    expect(localToUtc("2026-12-03", "", "UTC").toISOString()).toBe("2026-12-03T10:00:00.000Z"); // default 10:00
    expect(localToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z"); // summer time
    expect(localToUtc("2026-12-03", "09:00", "Not/AZone").toISOString()).toBe("2026-12-03T09:00:00.000Z");
  });
});

describe("the Facebook sign-in state", () => {
  it("round-trips, and refuses a changed, foreign or expired state", () => {
    const s = signState({ userId: "u1", organizationId: "o1", clientId: "c1" }, SECRET, 1_000_000);
    expect(verifyState(s, SECRET, 1_000_000)).toEqual({ userId: "u1", organizationId: "o1", clientId: "c1" });
    expect(verifyState(s, "t".repeat(40), 1_000_000)).toBeNull();
    expect(verifyState(s.slice(0, -2) + "xx", SECRET, 1_000_000)).toBeNull();
    expect(verifyState(s, SECRET, 1_000_000 + 16 * 60_000)).toBeNull();
    expect(verifyState("junk", SECRET)).toBeNull();
  });
  it("asks Facebook for posting permissions and comes back to our callback", () => {
    const u = new URL(loginUrl("123456", "st", { baseUrl: "https://app.example" }));
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example/api/social/meta/callback");
    expect(u.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(u.searchParams.get("scope")).toContain("instagram_content_publish");
  });
});

describe("what Meta's errors mean", () => {
  it("expired token, permission, rate limit, still processing, other", () => {
    expect(classify(new GraphError("Session expired", 190, 463, 400)).kind).toBe("EXPIRED");
    expect(classify(new GraphError("No permission", 200, null, 403)).kind).toBe("PERMISSION");
    expect(classify(new GraphError("Too many calls", 32, null, 400)).kind).toBe("RETRY");
    expect(classify(new GraphError("Server", 0, null, 503)).kind).toBe("RETRY");
    expect(classify(new GraphError("Not ready", 9007, 2207027, 400)).kind).toBe("WAIT");
    expect(classify(new GraphError("Bad image", 100, null, 400))).toEqual({ kind: "FAIL", message: "Bad image" });
    expect(classify(new Error("socket hang up")).kind).toBe("RETRY");
  });
});

describe("what can go out automatically", () => {
  it("Facebook and Instagram only; Facebook stories and live videos by hand", () => {
    expect(autoPlatforms({ platforms: ["FACEBOOK", "INSTAGRAM", "TIKTOK"], platform: "FACEBOOK", postType: "STATIC" })).toEqual(["FACEBOOK", "INSTAGRAM"]);
    expect(autoPlatforms({ platforms: ["FACEBOOK", "INSTAGRAM"], platform: "FACEBOOK", postType: "STORY" })).toEqual(["INSTAGRAM"]);
    expect(autoPlatforms({ platforms: ["INSTAGRAM"], platform: "INSTAGRAM", postType: "LIVE" })).toEqual([]);
    expect(autoPlatforms({ platforms: [], platform: "FACEBOOK", postType: "STATIC" })).toEqual(["FACEBOOK"]);
  });
  it("one video wins; otherwise up to ten images; documents are ignored", () => {
    const img = (i: number) => ({ id: `i${i}`, contentType: "image/png", filename: `${i}.png` });
    expect(pickMedia([img(1), { id: "v", contentType: "video/mp4", filename: "v.mp4" }])).toMatchObject({ kind: "VIDEO", file: { id: "v" } });
    const many = pickMedia(Array.from({ length: 12 }, (_, i) => img(i)));
    expect(many.kind === "IMAGES" && many.files.length).toBe(10);
    expect(pickMedia([{ id: "d", contentType: "application/pdf", filename: "brief.pdf" }]).kind).toBe("NONE");
  });
  it("Instagram needs media, a reel needs a video, a story one item", () => {
    const none = pickMedia([]), two = pickMedia([{ id: "a", contentType: "image/jpeg", filename: "a" }, { id: "b", contentType: "image/jpeg", filename: "b" }]);
    expect(mediaProblem("INSTAGRAM", "STATIC", none)).toMatch(/needs an image/);
    expect(mediaProblem("FACEBOOK", "STATIC", none)).toBeNull(); // text-only Page post is fine
    expect(mediaProblem("INSTAGRAM", "REEL", two)).toMatch(/video post/);
    expect(mediaProblem("INSTAGRAM", "STORY", two)).toMatch(/one image or one video/);
    expect(mediaProblem("INSTAGRAM", "CAROUSEL", two)).toBeNull();
  });
});
