import { describe, expect, it, vi } from "vitest";
import { SocialError, parseCount, parseDetails, parsePosts, socialApis, type CallGuard } from "./social";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const guard = () => { const reserved: string[] = [], released: string[] = []; const g: CallGuard = { reserve: async (sku) => { reserved.push(sku); return { id: `r${reserved.length}` }; }, release: async (id) => { released.push(id); } }; return { g, reserved, released }; };

describe("reading numbers", () => {
  it("reads whole numbers, thousands separators and K, M, B suffixes", () => {
    expect(parseCount(38500000)).toBe(38500000);
    expect(parseCount("1,234")).toBe(1234);
    expect(parseCount("12.5K")).toBe(12500);
    expect(parseCount("3.2M followers")).toBe(3200000);
    expect(parseCount("1B")).toBe(1e9);
  });
  it("gives nothing for anything else", () => {
    for (const v of [null, undefined, "", "many", -5, NaN, {}, []]) expect(parseCount(v), String(v)).toBeNull();
  });
});

describe("reading the answers", () => {
  it("reads page details whether or not they are wrapped", () => {
    expect(parseDetails({ title: "Smile Dental", followers_count: 4100 })).toEqual({ name: "Smile Dental", followers: 4100, likes: null });
    expect(parseDetails({ data: { title: "Smile", followers_count: "4.1K", likes_count: 3900 } })).toEqual({ name: "Smile", followers: 4100, likes: 3900 });
    expect(parseDetails(null)).toEqual({ name: null, followers: null, likes: null });
    expect(parseDetails("nonsense")).toEqual({ name: null, followers: null, likes: null });
  });
  it("takes the newest post date even when a pinned old post comes first", () => {
    const body = { posts: [{ created_time: "2023-01-01T00:00:00Z" }, { created_time: "2026-10-30T10:00:00Z" }, { created_time: "2026-09-01T10:00:00Z" }] };
    expect(parsePosts(body, new Date("2026-11-04T00:00:00Z"))?.toISOString()).toBe("2026-10-30T10:00:00.000Z");
    expect(parsePosts([{ created_time: 1761800000 }], new Date("2026-11-04T00:00:00Z"))?.getUTCFullYear()).toBe(2025);
    expect(parsePosts({ data: [{ created_time: "2026-10-01T00:00:00Z" }] }, new Date("2026-11-04T00:00:00Z"))).not.toBeNull();
  });
  it("ignores dates in the far future and posts without a usable date", () => {
    expect(parsePosts({ posts: [{ created_time: "2030-01-01T00:00:00Z" }, { created_time: "not a date" }, {}] }, new Date("2026-11-04T00:00:00Z"))).toBeNull();
    expect(parsePosts({ posts: [] })).toBeNull();
    expect(parsePosts(undefined)).toBeNull();
  });
});

describe("the SocialAPIs provider", () => {
  const page = "https://www.facebook.com/smiledental";
  it("asks for details then posts, with the key in the header and the page in the query, and reserves a call for each", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ title: "Smile Dental", followers_count: 4100 })).mockResolvedValueOnce(json({ posts: [{ created_time: "2026-10-30T10:00:00Z" }] }));
    const { g, reserved, released } = guard();
    const r = await socialApis(f as never).fetchPage({ apiKey: "SECRETKEY", pageUrl: page, guard: g });
    expect(r).toMatchObject({ name: "Smile Dental", followers: 4100, likes: null });
    expect(r.lastPostAt?.toISOString()).toBe("2026-10-30T10:00:00.000Z");
    expect(reserved).toEqual(["SOCIAL_FB_PAGE_DETAILS", "SOCIAL_FB_PAGE_POSTS"]);
    expect(released).toEqual([]);
    const [u1, o1] = f.mock.calls[0];
    expect(String(u1)).toBe(`https://api.socialapis.io/facebook/pages/details?link=${encodeURIComponent(page)}`);
    expect((o1 as { headers: Record<string, string> }).headers["x-api-token"]).toBe("SECRETKEY");
    expect(String(f.mock.calls[1][0])).toContain("/facebook/pages/posts?link=");
    expect(String(u1)).not.toContain("SECRETKEY");
  });
  it("keeps the followers when only the posts request fails", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ followers_count: 10 })).mockResolvedValueOnce(json({}, 500));
    const { g, released } = guard();
    const r = await socialApis(f as never).fetchPage({ apiKey: "K", pageUrl: page, guard: g });
    expect(r).toMatchObject({ followers: 10, lastPostAt: null });
    expect(released).toEqual([]); // a server error stays on the ledger, the safe side
  });
  it("gives the call back when the key is refused, the page is not found or the service limits us, and says which", async () => {
    for (const [status, kind] of [[401, "KEY"], [403, "KEY"], [429, "LIMIT"], [404, "NOT_FOUND"], [422, "NOT_FOUND"]] as const) {
      const { g, released } = guard();
      await expect(socialApis(vi.fn().mockResolvedValue(json({}, status)) as never).fetchPage({ apiKey: "K", pageUrl: page, guard: g })).rejects.toMatchObject({ kind });
      expect(released, String(status)).toEqual(["r1"]);
    }
  });
  it("gives the call back on a network failure and never puts the key in a message", async () => {
    const { g, released } = guard();
    const err = await socialApis(vi.fn().mockRejectedValue(new Error("boom https://api.socialapis.io SECRETKEY")) as never).fetchPage({ apiKey: "SECRETKEY", pageUrl: page, guard: g }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialError);
    expect(err.message).not.toContain("SECRETKEY");
    expect(released).toEqual(["r1"]);
  });
  it("says not found when details come back empty, and stops when the key is refused on the second request", async () => {
    await expect(socialApis(vi.fn().mockResolvedValue(json({})) as never).fetchPage({ apiKey: "K", pageUrl: page, guard: guard().g })).rejects.toMatchObject({ kind: "NOT_FOUND" });
    const f = vi.fn().mockResolvedValueOnce(json({ followers_count: 1 })).mockResolvedValueOnce(json({}, 401));
    await expect(socialApis(f as never).fetchPage({ apiKey: "K", pageUrl: page, guard: guard().g })).rejects.toMatchObject({ kind: "KEY" });
  });
  it("does not make the second request when the budget refuses it", async () => {
    const f = vi.fn().mockResolvedValue(json({ followers_count: 5 }));
    const g: CallGuard = { reserve: vi.fn().mockResolvedValueOnce({ id: "a" }).mockRejectedValueOnce(new Error("budget")), release: async () => undefined };
    const r = await socialApis(f as never).fetchPage({ apiKey: "K", pageUrl: page, guard: g });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ followers: 5, lastPostAt: null });
  });
});
