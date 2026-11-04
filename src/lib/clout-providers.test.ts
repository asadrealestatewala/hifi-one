import { describe, expect, it, vi } from "vitest";
import { ApifyProvider, FutureProvider, YtDlpProvider, classifyYtDlpError, fetchWithFallback, mapApifyItem, parseYtDlpJson, type ProviderResult, type Registry, type Stats, type StatsProvider } from "./clout-providers";

const stats: Stats = { views: 10, likes: 2, comments: 1, shares: null, saves: null, caption: "hi", author: "a", postedAt: null, thumbnail: null, externalId: "1" };
const fake = (id: "YTDLP" | "APIFY" | "FUTURE", r: ProviderResult): StatsProvider & { calls: number } => { const o = { id, calls: 0, async fetch() { o.calls++; return r; } }; return o; };
const reg = (y: StatsProvider, a: StatsProvider): Registry => ({ YTDLP: y, APIFY: a, FUTURE: new FutureProvider() });
const ok: ProviderResult = { ok: true, stats };
const bad = (kind: "gone" | "blocked" | "error" | "not_configured"): ProviderResult => ({ ok: false, kind, message: kind });

describe("provider fallback", () => {
  it("uses the primary when it answers and does not call the backup", async () => {
    const y = fake("YTDLP", ok), a = fake("APIFY", ok);
    const r = await fetchWithFallback(reg(y, a), "u", "TIKTOK", "YTDLP", "APIFY");
    expect(r).toMatchObject({ ok: true, provider: "YTDLP", tried: ["YTDLP"] });
    expect(a.calls).toBe(0);
  });
  it.each(["blocked", "error", "gone", "not_configured"] as const)("retries with the backup when the primary says %s, and records who answered", async (k) => {
    const y = fake("YTDLP", bad(k)), a = fake("APIFY", ok);
    const r = await fetchWithFallback(reg(y, a), "u", "INSTAGRAM", "YTDLP", "APIFY");
    expect(r).toMatchObject({ ok: true, provider: "APIFY", tried: ["YTDLP", "APIFY"] });
  });
  it("is gone only when every source that could answer says gone", async () => {
    expect(await fetchWithFallback(reg(fake("YTDLP", bad("gone")), fake("APIFY", bad("gone"))), "u", "TIKTOK", "YTDLP", "APIFY")).toMatchObject({ ok: false, kind: "gone" });
    expect(await fetchWithFallback(reg(fake("YTDLP", bad("gone")), fake("APIFY", bad("blocked"))), "u", "TIKTOK", "YTDLP", "APIFY")).toMatchObject({ ok: false, kind: "blocked" });
    expect(await fetchWithFallback(reg(fake("YTDLP", bad("gone")), fake("APIFY", bad("error"))), "u", "TIKTOK", "YTDLP", "APIFY")).toMatchObject({ ok: false, kind: "error" });
  });
  it("a backup that is not configured does not turn a primary 'gone' into anything else", async () => {
    expect(await fetchWithFallback(reg(fake("YTDLP", bad("gone")), fake("APIFY", bad("not_configured"))), "u", "TIKTOK", "YTDLP", "APIFY")).toMatchObject({ ok: false, kind: "gone" });
  });
  it("reports not configured when no source can answer", async () => {
    expect(await fetchWithFallback(reg(fake("YTDLP", bad("not_configured")), fake("APIFY", bad("not_configured"))), "u", "TIKTOK", "YTDLP", "APIFY")).toMatchObject({ ok: false, kind: "not_configured" });
  });
  it("does not call the same source twice and survives a source that throws", async () => {
    const y = fake("YTDLP", bad("blocked"));
    const boom: StatsProvider = { id: "APIFY", fetch: async () => { throw new Error("network down"); } };
    expect(await fetchWithFallback(reg(y, boom), "u", "TIKTOK", "YTDLP", "YTDLP")).toMatchObject({ ok: false, kind: "blocked", tried: ["YTDLP"] });
    expect(await fetchWithFallback(reg(y, boom), "u", "TIKTOK", "YTDLP", "APIFY")).toMatchObject({ ok: false, kind: "blocked" });
  });
  it("the placeholder provider never answers", async () => {
    expect(await new FutureProvider().fetch()).toMatchObject({ ok: false, kind: "not_configured" });
  });
});

describe("yt-dlp output", () => {
  it("parses the public numbers and ignores private fields", () => {
    const s = parseYtDlpJson(JSON.stringify({ id: "123", view_count: 1500, like_count: 90, comment_count: 7, repost_count: 3, description: "Nice #ad", uploader_id: "sara", timestamp: 1730000000, thumbnail: "https://cdn.example/t.jpg", formats: [{ url: "x" }] }));
    expect(s).toMatchObject({ views: 1500, likes: 90, comments: 7, shares: 3, caption: "Nice #ad", author: "sara", externalId: "123", thumbnail: "https://cdn.example/t.jpg" });
    expect(s!.postedAt!.getUTCFullYear()).toBe(2024);
  });
  it("accepts missing numbers but refuses an answer with none", () => {
    expect(parseYtDlpJson(JSON.stringify({ id: "1", view_count: 5 }))).toMatchObject({ views: 5, likes: null });
    expect(parseYtDlpJson(JSON.stringify({ id: "1", title: "x" }))).toBeNull();
    expect(parseYtDlpJson("not json")).toBeNull();
  });
  it("drops non-https thumbnails", () => { expect(parseYtDlpJson(JSON.stringify({ view_count: 1, thumbnail: "javascript:alert(1)" }))!.thumbnail).toBeNull(); });
  it.each([
    ["ERROR: [TikTok] 1: Video not available, status code 404", "gone"],
    ["ERROR: [Instagram] C0: This video is private", "gone"],
    ["ERROR: [facebook] 1: Video unavailable", "gone"],
    ["ERROR: [Instagram] C0: Instagram API is not granting access: login required", "blocked"],
    ["ERROR: [TikTok] 1: Unable to download webpage: HTTP Error 429: Too Many Requests", "blocked"],
    ["ERROR: [facebook] 1: Cannot parse data; please report this issue", "error"],
    ["ERROR: Unable to connect to proxy", "blocked"],
  ])("sorts %j as %s", (text, kind) => { expect(classifyYtDlpError(text).kind).toBe(kind); });
  it("calls the tool without a shell, with the link after '--', and reports a missing tool honestly", async () => {
    const runner = vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ view_count: 1, like_count: 1, comment_count: 1 }) + "\n", stderr: "" }));
    const r = await new YtDlpProvider(runner as never, "yt-dlp").fetch("https://www.tiktok.com/@a/video/123456");
    expect(r.ok).toBe(true);
    const args = (runner.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args).toEqual(expect.arrayContaining(["--dump-json", "--skip-download"]));
    expect(args.slice(-2)).toEqual(["--", "https://www.tiktok.com/@a/video/123456"]);
    const missing = await new YtDlpProvider((async () => ({ code: null, stdout: "", stderr: "", missing: true })) as never).fetch("https://x");
    expect(missing).toMatchObject({ ok: false, kind: "not_configured" });
  });
});

describe("Apify", () => {
  it("is not configured without a token and makes no request", async () => {
    const f = vi.fn();
    expect(await new ApifyProvider(f as never, () => undefined).fetch("https://x", "TIKTOK")).toMatchObject({ ok: false, kind: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });
  it("maps the common TikTok and Instagram field names", () => {
    expect(mapApifyItem({ id: "9", playCount: 100, diggCount: 10, commentCount: 2, shareCount: 1, collectCount: 4, text: "t", authorMeta: { name: "sara" } })).toMatchObject({ views: 100, likes: 10, comments: 2, shares: 1, saves: 4, author: "sara" });
    expect(mapApifyItem({ shortCode: "abc", videoPlayCount: 55, likesCount: 5, commentsCount: 1, ownerUsername: "x" })).toMatchObject({ views: 55, likes: 5, comments: 1, author: "x" });
    expect(mapApifyItem({ foo: 1 })).toBeNull();
  });
  it("sends the token in a header, never in the address, and classifies errors", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ playCount: 5, diggCount: 1, commentCount: 0 }]), { status: 200 }));
    const r = await new ApifyProvider(f as never, () => "SECRET-123").fetch("https://www.tiktok.com/@a/video/123456", "TIKTOK");
    expect(r.ok).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("SECRET-123");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SECRET-123");
    const empty = new ApifyProvider((async () => new Response("[]", { status: 200 })) as never, () => "SECRET-123");
    expect(await empty.fetch("https://x", "TIKTOK")).toMatchObject({ ok: false, kind: "gone" });
    expect(await new ApifyProvider((async () => new Response("", { status: 429 })) as never, () => "SECRET-123").fetch("https://x", "TIKTOK")).toMatchObject({ ok: false, kind: "blocked" });
  });
});
