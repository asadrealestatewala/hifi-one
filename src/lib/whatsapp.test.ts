import { describe, expect, it } from "vitest";
import { templates, whatsappLink, whatsappNumber } from "./whatsapp";

describe("whatsapp numbers", () => {
  it("accepts international formats and strips punctuation", () => {
    expect(whatsappNumber("+92 316 8080801")).toBe("923168080801");
    expect(whatsappNumber("+1 (778) 652-1616")).toBe("17786521616");
    expect(whatsappNumber("0092 316 8080801")).toBe("923168080801");
  });
  it("expands a local number with the default country code", () => {
    expect(whatsappNumber("0316 8080801")).toBe("923168080801");
    expect(whatsappNumber("0316 8080801", "971")).toBe("9713168080801");
  });
  it("refuses anything that cannot be a phone number", () => {
    for (const bad of [null, undefined, "", "abc", "12345", "+0123456789", "1".repeat(16)]) expect(whatsappNumber(bad as never), String(bad)).toBeNull();
  });
});

describe("whatsapp links", () => {
  it("builds a wa.me link with the text encoded", () => {
    const l = whatsappLink("+92 316 8080801", "Hello & welcome? 100% sure")!;
    expect(l.startsWith("https://wa.me/923168080801?text=")).toBe(true);
    expect(l).toContain("Hello%20%26%20welcome%3F%20100%25%20sure");
    expect(new URL(l).searchParams.get("text")).toBe("Hello & welcome? 100% sure");
  });
  it("returns null without a usable number and caps very long text", () => {
    expect(whatsappLink("n/a", "hi")).toBeNull();
    expect(new URL(whatsappLink("+923168080801", "x".repeat(5000))!).searchParams.get("text")!.length).toBe(1000);
  });
  it("templates mention the facts a person needs and nothing secret", () => {
    const t = templates.paymentReminder("Acme", "INV-000042", "$250.00", "2026-10-01", "Hifi");
    expect(t).toContain("INV-000042");
    expect(t).toContain("$250.00");
    expect(t).toContain("2026-10-01");
    expect(templates.paymentReminder("Acme", "INV-1", "$1.00", null, "Hifi")).not.toContain("was due");
  });
});
