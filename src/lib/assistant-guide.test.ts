import { describe, expect, it } from "vitest";
import { buildGuide, TOPICS } from "./assistant-guide";

describe("assistant guide", () => {
  it("explains how a client signs in to the portal", () => {
    const g = buildGuide(new Set());
    const t = g.topics.find((x) => /client signs in/i.test(x.topic));
    expect(t?.answer).toMatch(/Portal access/);
    expect(t?.answer).toMatch(/7 days/);
  });
  it("only lists screens and jobs the role can open", () => {
    const none = buildGuide(new Set());
    const finance = buildGuide(new Set(["finance.post", "clients.view"]));
    expect(JSON.stringify(none.jobs)).not.toMatch(/Create an invoice/);
    expect(JSON.stringify(finance.jobs)).toMatch(/Create an invoice/);
    expect(JSON.stringify(none.menu)).not.toMatch(/Payroll/);
  });
  it("keeps admin-only topics from people without the permission", () => {
    expect(TOPICS.some((t) => t.permission)).toBe(true);
    expect(buildGuide(new Set()).topics.some((t) => /API keys/.test(t.topic))).toBe(false);
    expect(buildGuide(new Set(["settings.company.view"])).topics.some((t) => /API keys/.test(t.topic))).toBe(true);
  });
});
