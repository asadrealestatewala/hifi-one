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

import { cleanSlides } from "./design";
import { designFiles } from "./social-meta";
import { planDesignWords } from "./content-ai";

describe("carousels, month designs and what gets posted", () => {
  it("a carousel has 3 to 8 slides, each with a headline; empty rows are dropped", () => {
    const rows = [{ headline: "Cover", sub: "" }, { headline: "", sub: "" }, { headline: "Point one", sub: "Why it matters" }, { headline: "Order now", sub: "" }];
    expect(cleanSlides(rows)).toEqual([{ headline: "Cover", sub: null }, { headline: "Point one", sub: "Why it matters" }, { headline: "Order now", sub: null }]);
    expect(() => cleanSlides(rows.slice(0, 2))).toThrow(/3 to 8/);
    expect(() => cleanSlides([...rows, { headline: "", sub: "text only" }])).toThrow(/Slide 5 needs a headline/);
    expect(() => cleanSlides(Array.from({ length: 9 }, () => ({ headline: "x", sub: "" })))).toThrow(/3 to 8/);
  });
  it("planner words become a text-layout design, or nothing when unusable", () => {
    expect(planDesignWords({ headline: " Eid   offer ", sub: "", cta: "Order", label: "", layout: "OFFER" })).toEqual({ headline: "Eid offer", sub: null, cta: "Order", label: null, layout: "BOLD" });
    expect(planDesignWords({ headline: "", sub: "x", cta: "", label: "", layout: "TIP" })).toBeNull();
    expect(planDesignWords({ headline: "عید مبارک", sub: "", cta: "", label: "", layout: "TIP" })).toBeNull();
  });
  it("automatic posting sends the design: the right size, carousel slides in order, but a video or a later hand upload wins", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 17, 10, m));
    const f = (id: string, m: number, contentType = "image/png") => ({ id, contentType, filename: id, createdAt: t(m) });
    const files = [f("photo", 1, "image/jpeg"), f("sq", 2), f("pt", 2), f("st", 2)];
    const single = { kind: "SINGLE", sizes: ["SQUARE", "PORTRAIT", "STORY"], outputFileIds: ["sq", "pt", "st"], photoFileId: "photo" };
    expect(designFiles(files, single, "STATIC").map((x) => x.id)).toEqual(["pt"]);
    expect(designFiles(files, single, "STORY").map((x) => x.id)).toEqual(["st"]);
    expect(designFiles(files, { ...single, sizes: ["SQUARE"], outputFileIds: ["sq"] }, "STATIC").map((x) => x.id)).toEqual(["sq"]);
    expect(designFiles(files, { kind: "CAROUSEL", sizes: ["SQUARE"], outputFileIds: ["st", "sq", "pt"], photoFileId: null }, "CAROUSEL").map((x) => x.id)).toEqual(["st", "sq", "pt"]);
    expect(designFiles([...files, f("mine", 9, "image/jpeg")], single, "STATIC").map((x) => x.id)).toEqual(["mine"]);
    expect(designFiles([...files, f("clip", 0, "video/mp4")], single, "REEL")).toHaveLength(5);
    expect(designFiles(files, null, "STATIC")).toHaveLength(4);
  });
});
