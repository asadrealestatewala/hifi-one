import { describe, expect, it } from "vitest";
import { BrandError, brandPromptLine, cleanColors, pageColors, pageDetails, pageFonts } from "./brand-kit";

describe("brand colours", () => {
  it("keeps one colour per role, upper-cases, and refuses a bad value", () => {
    expect(cleanColors([{ role: "PRIMARY", hex: "#4f46e5" }, { role: "PRIMARY", hex: "#000000" }, { role: "NOPE", hex: "#111111" }])).toEqual([{ role: "PRIMARY", hex: "#4F46E5" }]);
    expect(() => cleanColors([{ role: "ACCENT", hex: "red" }])).toThrow(BrandError);
    expect(brandPromptLine({ colors: [{ role: "PRIMARY", hex: "#4F46E5" }] })).toBe("Use the brand's colours: primary #4F46E5.");
    expect(brandPromptLine(null)).toBeNull();
  });
});

describe("reading a website", () => {
  const html = `<html><head><meta name="theme-color" content="#E11D48"><link rel="apple-touch-icon" href="/icon-180.png">
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&amp;family=Lora&display=swap" rel="stylesheet"></head>
    <body style="color:#333333;background:#ffffff"><img class="site-logo" src="/img/brand.svg" alt="Acme">
    <a href="tel:+92 300 1234567">Call</a><a href="https://wa.me/923001234567">WhatsApp</a><a href="https://www.instagram.com/acme.pk/">IG</a>
    <div style="background:#0EA5E9"></div><div style="color:#0ea5e9"></div><span style="color:rgb(16, 185, 129)"></span></body></html>`;
  it("finds brand colours, theme-color first, without white, black or grey", () => {
    const c = pageColors(html, [".btn{background:#0EA5E9}.x{color:#fafafa}"]);
    expect(c[0]).toBe("#E11D48");
    expect(c).toContain("#0EA5E9");
    expect(c).toContain("#10B981");
    expect(c).not.toContain("#333333");
    expect(c).not.toContain("#FFFFFF");
  });
  it("finds fonts from Google Fonts links and font-family, matched to our list", () => {
    expect(pageFonts(html, ["h1{font-family:'Montserrat',sans-serif}body{font-family:Brandon Grotesque}"])).toEqual({ fonts: ["Poppins", "Lora"], other: ["Brandon Grotesque"] });
  });
  it("finds the logo, icon, phone, WhatsApp and Instagram handle", () => {
    expect(pageDetails(html, "https://acme.pk/home")).toEqual({ logoUrl: "https://acme.pk/img/brand.svg", iconUrl: "https://acme.pk/icon-180.png", phone: "+92 300 1234567", whatsapp: "+923001234567", handle: "@acme.pk" });
  });
});
