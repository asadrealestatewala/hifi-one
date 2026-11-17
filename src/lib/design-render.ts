// Draws a branded social media design as a PNG: the client's logo, colours, fonts and contact strip around a headline,
// a short line, a button text and (for most layouts) a photo. Our own code places every letter and the real logo, which the
// AI image tools cannot do reliably. Uses Next's built-in image renderer (Satori + Resvg), so nothing new is installed.
// Plain createElement instead of JSX so the file also runs under the test runner.
import fs from "node:fs";
import path from "node:path";
import { createElement, type CSSProperties, type ReactNode } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";

export const DESIGN_SIZES = { SQUARE: { w: 1080, h: 1080, label: "Square 1:1" }, PORTRAIT: { w: 1080, h: 1350, label: "Portrait 4:5" }, STORY: { w: 1080, h: 1920, label: "Story 9:16" } } as const;
export type DesignSize = keyof typeof DESIGN_SIZES;

export const DESIGN_LAYOUTS = {
  OFFER: { label: "Offer or sale", photo: true, hint: "Photo full size, big offer text at the bottom, button." },
  SPOTLIGHT: { label: "Product spotlight", photo: true, hint: "Product photo in a card, name and line below." },
  QUOTE: { label: "Quote or review", photo: false, hint: "Large quote on the brand colour, who said it." },
  ANNOUNCE: { label: "Announcement", photo: true, hint: "Headline on a colour block above the photo." },
  TIP: { label: "Tip or how-to", photo: false, hint: "Tag, headline and a short explanation." },
  EVENT: { label: "Event or date", photo: true, hint: "Date tag and headline over the photo." },
  FRAME: { label: "Framed photo", photo: true, hint: "Photo framed in the brand colour, headline bar." },
  BOLD: { label: "Bold headline", photo: false, hint: "Just the headline, big, on the brand colour." },
} as const;
export type DesignLayout = keyof typeof DESIGN_LAYOUTS;

export type DesignColors = { primary: string; secondary: string; accent: string; text: string; background: string };
export type DesignInput = {
  layout: DesignLayout; size: DesignSize; colors: DesignColors; headingFont: string; bodyFont: string;
  label?: string | null; headline: string; sub?: string | null; cta?: string | null;
  photo?: Buffer | null; logo?: Buffer | null; logoLight?: Buffer | null;
  logoCorner?: string; logoSizePct?: number; contact?: string[];
  // Carousel: which slide this is. A middle slide (not the first, not the last) is drawn as a numbered point.
  slide?: { index: number; total: number };
};

const FONT_DIR = () => path.join(process.cwd(), "assets", "fonts");
const slug = (f: string) => f.toLowerCase().replace(/ /g, "-");
const fontCache = new Map<string, Buffer | null>();
function fontFile(family: string, weight: 400 | 700): Buffer | null {
  const k = `${slug(family)}-${weight}`;
  if (!fontCache.has(k)) {
    let b: Buffer | null = null;
    for (const w of [weight, weight === 700 ? 400 : 700]) { try { b = fs.readFileSync(path.join(FONT_DIR(), `${slug(family)}-${w}.woff`)); break; } catch { /* try the other weight */ } }
    fontCache.set(k, b);
  }
  return fontCache.get(k) ?? null;
}

// White or near-black, whichever reads better on this colour
export function onColor(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // pick whichever of the two gives the higher contrast ratio (they cross near L = 0.2)
  return (L + 0.05) / 0.062 > 1.05 / (L + 0.05) ? "#111827" : "#FFFFFF";
}
const isDark = (hex: string) => onColor(hex) === "#FFFFFF";

// Headline size from its length and the canvas width, so short offers are huge and long ones still fit
export function headlineSize(text: string, w: number, scale = 1) {
  const n = text.length;
  return Math.round(w * scale * (n <= 16 ? 0.12 : n <= 28 ? 0.095 : n <= 44 ? 0.078 : n <= 64 ? 0.064 : 0.054));
}

const h = (type: string, style: CSSProperties, ...children: ReactNode[]) => createElement(type, { style: { display: "flex", ...style } }, ...children);
const img = (src: string, width: number, height: number, style: CSSProperties = {}) => createElement("img", { src, width, height, style });

async function photoUrl(photo: Buffer, w: number, hgt: number) {
  const out = await sharp(photo).rotate().resize(Math.round(w), Math.round(hgt), { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}
async function logoUrl(logo: Buffer, maxW: number, maxH: number) {
  const png = await sharp(logo, { density: 300 }).resize(Math.round(maxW), Math.round(maxH), { fit: "inside", withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true });
  return { src: `data:image/png;base64,${png.data.toString("base64")}`, w: png.info.width, h: png.info.height };
}

export async function drawDesign(d: DesignInput): Promise<Buffer> {
  const { w: W, h: H } = DESIGN_SIZES[d.size];
  const c = d.colors;
  const pad = Math.round(W * 0.07);
  const story = d.size === "STORY";
  const hs = (s = 1) => headlineSize(d.headline, W, s);
  const subSize = Math.round(W * 0.036);
  const contact = (d.contact ?? []).filter(Boolean);
  const stripH = contact.length ? Math.round(W * 0.075) : 0;
  const layout = DESIGN_LAYOUTS[d.layout] ? d.layout : "BOLD";
  const usesPhoto = DESIGN_LAYOUTS[layout].photo && Boolean(d.photo);

  const headline = (color: string, scale = 1, extra: CSSProperties = {}) => h("div", { fontFamily: "Heading", fontWeight: 700, fontSize: hs(scale), lineHeight: 1.08, color, letterSpacing: -0.5, ...extra }, d.headline);
  const sub = (color: string, extra: CSSProperties = {}) => (d.sub ? h("div", { fontFamily: "Body", fontSize: subSize, lineHeight: 1.35, color, marginTop: Math.round(W * 0.025), ...extra }, d.sub) : null);
  const button = (bg: string, extra: CSSProperties = {}) => (d.cta ? h("div", { fontFamily: "Heading", fontWeight: 700, fontSize: Math.round(W * 0.034), color: onColor(bg), background: bg, borderRadius: 999, padding: `${Math.round(W * 0.018)}px ${Math.round(W * 0.045)}px`, marginTop: Math.round(W * 0.04), alignSelf: "flex-start", ...extra }, d.cta) : null);
  const tag = (bg: string, extra: CSSProperties = {}) => (d.label ? h("div", { fontFamily: "Heading", fontWeight: 700, fontSize: Math.round(W * 0.03), color: onColor(bg), background: bg, borderRadius: 10, padding: `${Math.round(W * 0.012)}px ${Math.round(W * 0.026)}px`, alignSelf: "flex-start", textTransform: "uppercase", letterSpacing: 2, marginBottom: Math.round(W * 0.03), ...extra }, d.label) : null);

  // Where the logo sits, so text and photos keep clear of it
  const logoM = Math.round(W * 0.05);
  const logoCorner = d.logoCorner ?? "TOP_RIGHT";
  const logoMaxW = W * Math.min(30, Math.max(6, d.logoSizePct ?? 14)) / 100;
  const logoH = d.logo ? (await logoUrl(d.logo, logoMaxW, logoMaxW * 0.6)).h : 0;
  const top = d.logo && logoCorner.startsWith("TOP") ? Math.max(pad, logoM + logoH + Math.round(W * 0.03)) : pad;

  // Rough height of a tag + headline + sub + button stack, to size photos around the words instead of letting them overflow
  const lines = (text: string, size: number, width: number, charW: number) => Math.max(1, Math.ceil((text.length * size * charW) / width));
  const textH = (scale: number, width: number, withButton = true) => {
    const hz = hs(scale);
    return (d.label ? Math.round(W * 0.03) * 1.3 + Math.round(W * 0.024) + Math.round(W * 0.03) : 0)
      + lines(d.headline, hz, width, 0.52) * hz * 1.08
      + (d.sub ? Math.round(W * 0.025) + lines(d.sub, subSize, width, 0.48) * subSize * 1.35 : 0)
      + (withButton && d.cta ? Math.round(W * 0.04) + Math.round(W * 0.034) * 1.3 + Math.round(W * 0.036) : 0);
  };

  let body: ReactNode;
  let darkBehindLogo = isDark(c.primary);
  const inner = { position: "absolute" as const, left: 0, top: 0, width: W, height: H - stripH };

  const point = d.slide && d.slide.index > 0 && d.slide.index < d.slide.total - 1;
  if (point) {
    // A middle carousel slide: big slide number, the point, and its explanation, on the brand's light background
    darkBehindLogo = isDark(c.background);
    body = h("div", { ...inner, background: c.background, flexDirection: "column", justifyContent: "center", padding: pad * 1.2, paddingTop: Math.max(top, pad * 1.2) },
      h("div", { fontFamily: "Heading", fontWeight: 700, fontSize: Math.round(W * 0.16), lineHeight: 1, color: c.accent, marginBottom: Math.round(W * 0.03) }, String(d.slide!.index).padStart(2, "0")),
      headline(c.text, 0.9), sub(c.text, { fontSize: Math.round(subSize * 1.2), opacity: 0.85 }),
      h("div", { position: "absolute", left: 0, top: 0, width: Math.round(W * 0.025), height: H - stripH, background: c.primary }),
    );
  } else if (layout === "OFFER" && usesPhoto) {
    darkBehindLogo = true;
    body = h("div", { ...inner },
      img(await photoUrl(d.photo!, W, H - stripH), W, H - stripH, { position: "absolute", left: 0, top: 0 }),
      h("div", { position: "absolute", left: 0, top: 0, width: W, height: H - stripH, backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.78) 100%)" }),
      h("div", { position: "absolute", left: pad, right: pad, bottom: pad, flexDirection: "column" }, tag(c.accent), headline("#FFFFFF", story ? 1.1 : 1), sub("#F3F4F6"), button(c.accent)),
    );
  } else if (layout === "SPOTLIGHT" && usesPhoto) {
    darkBehindLogo = isDark(c.background);
    const cardH = Math.round(Math.min((H - stripH) * 0.55, H - stripH - top - pad - Math.round(W * 0.045) - textH(0.85, W - 2 * pad) - 8));
    body = h("div", { ...inner, background: c.background, flexDirection: "column", padding: pad, paddingTop: top },
      img(await photoUrl(d.photo!, W - 2 * pad, cardH), W - 2 * pad, cardH, { borderRadius: 32 }),
      h("div", { flexDirection: "column", marginTop: Math.round(W * 0.045) }, tag(c.accent), headline(c.text, 0.85), sub(c.text, { opacity: 0.8 }), button(c.primary)),
    );
  } else if (layout === "QUOTE") {
    darkBehindLogo = isDark(c.primary);
    body = h("div", { ...inner, background: c.primary, flexDirection: "column", justifyContent: "center", padding: pad * 1.3 },
      h("div", { fontFamily: "Heading", fontWeight: 700, fontSize: Math.round(W * 0.3), lineHeight: 0.8, color: c.accent, height: Math.round(W * 0.16) }, "“"),
      headline(onColor(c.primary), 0.8, { fontStyle: "normal" }),
      d.sub ? h("div", { fontFamily: "Body", fontSize: subSize, color: onColor(c.primary), opacity: 0.85, marginTop: Math.round(W * 0.05) }, `— ${d.sub}`) : null,
      button(c.accent),
    );
  } else if (layout === "ANNOUNCE" && usesPhoto) {
    darkBehindLogo = isDark(c.primary);
    const topH = Math.round(Math.max((H - stripH) * (story ? 0.48 : 0.42), top + textH(0.85, W - 2 * pad, false) + pad * 0.8 + Math.round(W * 0.03)));
    body = h("div", { ...inner, flexDirection: "column" },
      h("div", { width: W, height: topH, background: c.primary, flexDirection: "column", justifyContent: "flex-end", padding: pad, paddingTop: top, paddingBottom: Math.round(pad * 0.8) }, tag(c.accent), headline(onColor(c.primary), 0.85), sub(onColor(c.primary), { opacity: 0.9 })),
      img(await photoUrl(d.photo!, W, H - stripH - topH), W, H - stripH - topH),
      d.cta ? h("div", { position: "absolute", right: pad, top: topH - Math.round(W * 0.05) }, button(c.accent, { marginTop: 0 })) : null,
    );
  } else if (layout === "TIP") {
    darkBehindLogo = isDark(c.background);
    body = h("div", { ...inner, background: c.background, flexDirection: "column", justifyContent: "center", padding: pad * 1.2 },
      h("div", { width: Math.round(W * 0.12), height: 12, background: c.accent, borderRadius: 6, marginBottom: Math.round(W * 0.05) }),
      tag(c.primary), headline(c.text, 0.85), sub(c.text, { fontSize: Math.round(subSize * 1.15), opacity: 0.85 }), button(c.primary),
    );
  } else if (layout === "EVENT" && usesPhoto) {
    darkBehindLogo = true;
    body = h("div", { ...inner },
      img(await photoUrl(d.photo!, W, H - stripH), W, H - stripH, { position: "absolute", left: 0, top: 0 }),
      h("div", { position: "absolute", left: 0, top: 0, width: W, height: H - stripH, background: "rgba(0,0,0,0.45)" }),
      h("div", { position: "absolute", left: pad, right: pad, top: 0, bottom: 0, flexDirection: "column", justifyContent: "center" },
        d.label ? h("div", { fontFamily: "Heading", fontWeight: 700, fontSize: Math.round(W * 0.05), color: onColor(c.accent), background: c.accent, padding: `${Math.round(W * 0.015)}px ${Math.round(W * 0.035)}px`, alignSelf: "flex-start", borderRadius: 12, marginBottom: Math.round(W * 0.04) }, d.label) : null,
        headline("#FFFFFF", 1), sub("#F3F4F6"), button(c.primary)),
    );
  } else if (layout === "FRAME" && usesPhoto) {
    darkBehindLogo = isDark(c.secondary);
    const barH = Math.round(Math.max((H - stripH) * 0.22, Math.round(W * 0.03) + textH(0.75, W - 2 * pad, false) + 10));
    const photoH = H - stripH - barH - pad - top;
    body = h("div", { ...inner, background: c.secondary, flexDirection: "column", padding: pad, paddingTop: top },
      img(await photoUrl(d.photo!, W - 2 * pad, photoH), W - 2 * pad, photoH, { borderRadius: 24 }),
      h("div", { flexDirection: "column", justifyContent: "center", height: barH, paddingTop: Math.round(W * 0.03) }, headline(onColor(c.secondary), 0.75), sub(onColor(c.secondary), { opacity: 0.9, marginTop: 10 })),
    );
  } else {
    // BOLD, and any photo layout without a photo
    darkBehindLogo = isDark(c.primary);
    body = h("div", { ...inner, background: c.primary, flexDirection: "column", justifyContent: "center", padding: pad * 1.2 },
      tag(c.accent), headline(onColor(c.primary), 1.15), sub(onColor(c.primary), { opacity: 0.9 }), button(c.accent),
      h("div", { position: "absolute", right: -W * 0.15, bottom: -W * 0.15, width: W * 0.5, height: W * 0.5, borderRadius: W, background: c.accent, opacity: 0.25 }),
    );
  }

  // Logo in its corner, the light version on dark backgrounds when there is one
  let logoNode: ReactNode = null;
  const logoBytes = darkBehindLogo && d.logoLight ? d.logoLight : d.logo;
  if (logoBytes) {
    const l = await logoUrl(logoBytes, logoMaxW, logoMaxW * 0.6);
    const m = logoM, corner = logoCorner;
    const pos: CSSProperties = { position: "absolute", ...(corner.startsWith("TOP") ? { top: m } : { bottom: stripH + m }), ...(corner.endsWith("LEFT") ? { left: m } : { right: m }) };
    logoNode = h("div", pos, img(l.src, l.w, l.h));
  }
  const strip = contact.length ? h("div", { position: "absolute", left: 0, bottom: 0, width: W, height: stripH, background: c.text === c.primary ? "#111827" : c.text, color: onColor(c.text), fontFamily: "Body", fontSize: Math.round(W * 0.027), alignItems: "center", justifyContent: "center" }, contact.join("   •   ")) : null;

  const fonts = [
    { name: "Heading", data: fontFile(d.headingFont, 700) ?? fontFile("Poppins", 700)!, weight: 700 as const, style: "normal" as const },
    { name: "Body", data: fontFile(d.bodyFont, 400) ?? fontFile("Inter", 400)!, weight: 400 as const, style: "normal" as const },
  ];
  // Carousel progress dots, bottom right above the contact strip
  const dots = d.slide ? h("div", { position: "absolute", right: Math.round(W * 0.05), bottom: stripH + Math.round(W * 0.04), gap: 10, alignItems: "center" },
    ...Array.from({ length: d.slide.total }, (_, i) => h("div", { width: i === d.slide!.index ? 34 : 12, height: 12, borderRadius: 6, background: i === d.slide!.index ? c.accent : "rgba(128,128,128,0.55)" }))) : null;
  const tree = h("div", { width: W, height: H, position: "relative", background: c.background, overflow: "hidden" }, body, logoNode, dots, strip);
  const res = new ImageResponse(tree as never, { width: W, height: H, fonts: fonts.map((f) => ({ ...f, data: f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer })) });
  return Buffer.from(await res.arrayBuffer());
}
