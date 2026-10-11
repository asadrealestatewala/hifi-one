import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit, then blocks until the window passes", () => {
    let now = 0;
    const l = new RateLimiter(3, 1000, () => now);
    expect([l.take("a"), l.take("a"), l.take("a"), l.take("a")]).toEqual([true, true, true, false]);
    now = 999;
    expect(l.take("a")).toBe(false);
    now = 1001;
    expect(l.take("a")).toBe(true);
  });
  it("tracks keys independently", () => {
    const l = new RateLimiter(1, 1000, () => 0);
    expect(l.take("ip-1")).toBe(true);
    expect(l.take("ip-2")).toBe(true);
    expect(l.take("ip-1")).toBe(false);
  });
  it("reports how long to wait", () => {
    let now = 0;
    const l = new RateLimiter(1, 60_000, () => now);
    l.take("k");
    now = 10_000;
    expect(l.take("k")).toBe(false);
    expect(l.retryAfterSeconds("k")).toBe(50);
  });
  it("blocked attempts do not extend the lockout", () => {
    let now = 0;
    const l = new RateLimiter(1, 1000, () => now);
    l.take("k");
    for (now = 100; now < 900; now += 100) l.take("k");
    now = 1001;
    expect(l.take("k")).toBe(true);
  });
});
