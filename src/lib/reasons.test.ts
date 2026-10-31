import { describe, expect, it } from "vitest";
import { readReason } from "./reasons";

describe("readReason", () => {
  it("refuses a missing, blank or too-short reason", () => {
    for (const v of [null, undefined, "", "   ", "abc", "  ab  "]) expect(readReason(v).ok).toBe(false);
  });
  it("accepts and tidies a real reason", () => {
    expect(readReason("  Client  disputed\nthe work ")).toEqual({ ok: true, reason: "Client disputed the work" });
  });
  it("caps very long text", () => {
    const r = readReason("x".repeat(900));
    expect(r.ok && r.reason.length).toBe(500);
  });
});
