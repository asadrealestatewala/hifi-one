import { describe, expect, it, vi } from "vitest";
import { PageSpeedError, parsePageSpeed, runPageSpeed } from "./pagespeed";

const report = { lighthouseResult: { categories: { performance: { score: 0.43 }, seo: { score: 0.92 } }, audits: {
  "first-contentful-paint": { numericValue: 1834.6 }, "largest-contentful-paint": { numericValue: 4210.2 }, "total-blocking-time": { numericValue: 612 }, "cumulative-layout-shift": { numericValue: 0.1234 }, "speed-index": { numericValue: 3500.4 } } } };

describe("PageSpeed report", () => {
  it("reads scores out of 100 and the key speed numbers", () => {
    expect(parsePageSpeed(report)).toEqual({ mobileScore: 43, seoScore: 92, fcpMs: 1835, lcpMs: 4210, tbtMs: 612, cls: 0.123, speedIndexMs: 3500 });
  });
  it("keeps missing numbers empty instead of inventing them", () => {
    expect(parsePageSpeed({ lighthouseResult: { categories: { performance: { score: null } } } })).toMatchObject({ mobileScore: null, seoScore: null, lcpMs: null, cls: null });
    expect(() => parsePageSpeed({})).toThrow(PageSpeedError);
  });
});

describe("PageSpeed request", () => {
  it("asks for one mobile run with performance and SEO", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(report)));
    await runPageSpeed({ apiKey: "KEY", url: "https://a.test", fetchImpl: f as never });
    const u = new URL(String(f.mock.calls[0][0]));
    expect(u.searchParams.get("strategy")).toBe("mobile");
    expect(u.searchParams.getAll("category")).toEqual(["performance", "seo"]);
    expect(u.searchParams.get("url")).toBe("https://a.test");
  });
  it("turns failures into plain reasons that never contain the key or the address", async () => {
    const mk = (status: number, message = "") => vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message } }), { status }));
    const key = await runPageSpeed({ apiKey: "SECRETKEY", url: "https://a.test", fetchImpl: mk(403, "API key not valid") as never }).catch((e) => e);
    expect(key).toMatchObject({ kind: "KEY" }); expect(String(key.message)).not.toMatch(/SECRETKEY|a\.test/);
    expect(await runPageSpeed({ apiKey: "k", url: "https://a.test", fetchImpl: mk(429) as never }).catch((e) => e)).toMatchObject({ kind: "LIMIT" });
    expect(await runPageSpeed({ apiKey: "k", url: "https://a.test", fetchImpl: mk(400, "FAILED_DOCUMENT_REQUEST. Lighthouse returned error") as never }).catch((e) => e)).toMatchObject({ kind: "UNREACHABLE" });
    expect(await runPageSpeed({ apiKey: "k", url: "https://a.test", fetchImpl: vi.fn().mockRejectedValue(new Error("boom")) as never }).catch((e) => e)).toBeInstanceOf(PageSpeedError);
  });
});
