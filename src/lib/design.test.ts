import { describe, expect, it } from "vitest";
import { cleanWords, contactLine, defaultSizes, kitColors, wordsPrompt } from "./design";
import { headlineSize, onColor } from "./design-render";

describe("design words and helpers", () => {
  it("trims words, needs a headline, keeps limits and refuses Urdu or Arabic script", () => {
    expect(cleanWords({ headline: "  Fresh   burgers ", cta: "", label: "New" })).toEqual({ headline: "Fresh burgers", sub: null, cta: null, label: "New" });
    expect(() => cleanWords({ headline: "" })).toThrow(/headline/);
    expect(() => cleanWords({ headline: "x".repeat(61) })).toThrow(/too long/);
    expect(() => cleanWords({ headline: "تازہ برگر" })).toThrow(/Urdu or Arabic/);
    expect(cleanWords({ headline: "Taaza burger, abhi order karein" }).headline).toMatch(/Taaza/);
  });
  it("picks sizes by post type, kit colours with fallbacks, and a tidy contact strip", () => {
    expect([defaultSizes("STORY"), defaultSizes("REEL"), defaultSizes("STATIC"), defaultSizes("CAROUSEL")]).toEqual([["STORY"], ["STORY"], ["PORTRAIT"], ["SQUARE"]]);
    const c = kitColors([{ role: "PRIMARY", hex: "#E11D48" }, { role: "ACCENT", hex: "bad" }]);
    expect([c.primary, c.accent]).toEqual(["#E11D48", "#10B981"]);
    expect(contactLine({ phone: null, whatsapp: "0300 1234567", website: "https://www.acme.pk/", handle: "acme" })).toEqual(["0300 1234567", "acme.pk", "@acme"]);
    expect(contactLine(null)).toEqual([]);
  });
  it("text colour reads on its background and headlines shrink as they grow", () => {
    expect([onColor("#FFFFFF"), onColor("#1E3A8A"), onColor("#F59E0B")]).toEqual(["#111827", "#FFFFFF", "#111827"]);
    expect(headlineSize("Sale", 1080)).toBeGreaterThan(headlineSize("A much longer headline that keeps going on", 1080));
  });
  it("asks Claude for short on-image words in Latin letters and never invented claims", () => {
    const p = wordsPrompt({ clientName: "Acme", profile: null, item: { title: "Winter sale", copy: "20% off boots", brief: null, postType: "STATIC" }, note: "mention delivery", hasPhoto: false });
    expect(p).toMatch(/8 words or fewer/);
    expect(p).toMatch(/Roman Urdu only/);
    expect(p).toMatch(/Never invent prices/);
    expect(p).toMatch(/prefer QUOTE, TIP or BOLD/);
    expect(p).toMatch(/mention delivery/);
  });
});
