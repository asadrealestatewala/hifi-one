// The Hifi Partner Stack certificate: one landscape A4 page with the partner's name, the Solution, issue and expiry dates,
// the Partner ID, a unique certificate id and a QR code that opens the public verification page. Four designs share the
// same facts; the admin picks one in Partner Stack settings. Takes plain data and returns the file as a Buffer.
// The standard PDF fonts cover Western European letters only; any other character is printed as "?" rather than wrongly.
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export const CERTIFICATE_DESIGNS = [
  { key: "classic", label: "Classic", hint: "Centred text inside a double border." },
  { key: "modern", label: "Modern", hint: "Navy side panel with the Solution, clean text on the right." },
  { key: "academy", label: "Academy", hint: "Large round seal, colour band on top, signature line." },
  { key: "course", label: "Course", hint: "Warm paper colour, serif name, ribbon with badge on the right." },
] as const;
export type CertificateDesign = (typeof CERTIFICATE_DESIGNS)[number]["key"];
export const isCertificateDesign = (v: string): v is CertificateDesign => CERTIFICATE_DESIGNS.some((d) => d.key === v);

export type CertificateData = {
  publicId: string;
  partnerId: string;
  partnerName: string;
  solutionName: string;
  partnerType: string;
  issuedAt: Date;
  expiresAt: Date;
  verifyUrl: string;
  company: string;
  design?: CertificateDesign;
  /** Optional person who signs for the programme; left out of the page when empty. */
  signatoryName?: string;
  signatoryTitle?: string;
};

const latin = (s: string) => s.replace(/[^ -~ -ÿ]/g, "?");
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const NAVY = "#1b2559";
const RED = "#e11d1d";
const INK = "#1f2433";
const MUTED = "#6b7080";

let logoCache: Buffer | null | undefined;
function logo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  try { logoCache = readFileSync(path.join(process.cwd(), "public", "logo.png")); } catch { logoCache = null; }
  return logoCache;
}

type Doc = InstanceType<typeof PDFDocument>;
type Ctx = { doc: Doc; c: CertificateData; qr: Buffer; W: number; H: number };

/** Name sized down until it fits on one line of the given width. */
function fitName(doc: Doc, text: string, font: string, max: number, min: number, width: number) {
  let size = max;
  doc.font(font);
  while (size > min && doc.fontSize(size).widthOfString(text) > width) size -= 1;
  return size;
}

function signature({ doc, c }: Ctx, x: number, y: number, width: number, dark = INK) {
  const name = (c.signatoryName ?? "").trim();
  if (!name) return false;
  doc.strokeColor("#b9bcc6").lineWidth(0.8).moveTo(x, y).lineTo(x + width, y).stroke();
  doc.fillColor(dark).font("Helvetica-Bold").fontSize(11).text(latin(name), x, y + 7, { width });
  const title = (c.signatoryTitle ?? "").trim();
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(latin(title ? `${title}, ${c.company}` : c.company), x, y + 22, { width });
  return true;
}

function detail({ doc }: Ctx, label: string, value: string, x: number, y: number, width: number, colour = INK) {
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(label.toUpperCase(), x, y, { width, characterSpacing: 1 });
  doc.fillColor(colour).font("Helvetica-Bold").fontSize(11.5).text(value, x, y + 13, { width });
}

function classic(ctx: Ctx) {
  const { doc, c, qr, W, H } = ctx;
  doc.rect(0, 0, W, H).fill("#ffffff");
  doc.lineWidth(3).strokeColor(NAVY).rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(1).strokeColor(RED).rect(32, 32, W - 64, H - 64).stroke();
  doc.fillColor(RED).font("Helvetica-Bold").fontSize(12).text("HIFI PARTNER STACK", 0, 66, { width: W, align: "center", characterSpacing: 3 });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(34).text("Certificate of Authorisation", 0, 92, { width: W, align: "center" });
  doc.fillColor("#555555").font("Helvetica").fontSize(13).text("This certifies that", 0, 158, { width: W, align: "center" });
  const name = latin(c.partnerName);
  doc.fillColor(NAVY).fontSize(fitName(doc, name, "Helvetica-Bold", 32, 18, W - 120)).text(name, 60, 184, { width: W - 120, align: "center" });
  doc.fillColor("#666666").font("Helvetica").fontSize(10).text(`Partner ID ${c.partnerId}`, 0, 222, { width: W, align: "center", characterSpacing: 1 });
  doc.strokeColor("#cccccc").lineWidth(0.8).moveTo(W / 2 - 160, 238).lineTo(W / 2 + 160, 238).stroke();
  doc.fillColor("#555555").font("Helvetica").fontSize(13).text(`is an authorised ${latin(c.partnerType)} for`, 0, 250, { width: W, align: "center" });
  doc.fillColor(RED).font("Helvetica-Bold").fontSize(26).text(latin(c.solutionName), 0, 272, { width: W, align: "center" });

  doc.fillColor("#333333").font("Helvetica").fontSize(11);
  doc.text("Issued", 70, 380); doc.font("Helvetica-Bold").text(fmt(c.issuedAt), 70, 396);
  doc.font("Helvetica").text("Valid until", 70, 424); doc.font("Helvetica-Bold").text(fmt(c.expiresAt), 70, 440);
  doc.font("Helvetica").text("Certificate ID", 270, 380); doc.font("Helvetica-Bold").text(c.publicId, 270, 396);
  doc.font("Helvetica").fontSize(9).fillColor("#666666").text("Check this certificate is genuine and still valid by scanning the code, or open:", 270, 424, { width: 300 });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(c.verifyUrl, 270, 448, { width: 300 });
  signature(ctx, 70, 488, 180);

  doc.image(qr, W - 190, 360, { width: 110 });
  doc.fillColor("#666666").font("Helvetica").fontSize(8).text("Scan to verify", W - 190, 474, { width: 110, align: "center" });
  doc.fillColor("#888888").font("Helvetica").fontSize(9).text(latin(`${c.company}. This certificate can be revoked or expire; always verify it online.`), 0, H - 62, { width: W, align: "center" });
}

function modern(ctx: Ctx) {
  const { doc, c, qr, W, H } = ctx;
  const P = 282; // side panel width
  doc.rect(0, 0, W, H).fill("#ffffff");
  doc.rect(0, 0, P, H).fill(NAVY);
  doc.rect(P, 0, 6, H).fill(RED);

  const l = logo();
  if (l) { doc.roundedRect(44, 46, 46, 46, 8).fill("#ffffff"); doc.image(l, 48, 50, { width: 38 }); }
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text("HIFI PARTNER STACK", 102, 56, { characterSpacing: 2.5 });
  doc.fillColor("#aab3d6").font("Helvetica").fontSize(9).text(latin(c.company), 102, 73, { width: P - 120 });

  doc.fillColor("#aab3d6").font("Helvetica").fontSize(9).text("AUTHORISED SOLUTION", 44, 196, { characterSpacing: 1.5 });
  const sol = latin(c.solutionName);
  doc.fillColor("#ffffff").fontSize(fitName(doc, sol, "Helvetica-Bold", 28, 16, P - 88)).text(sol, 44, 212, { width: P - 88 });
  const badge = latin(c.partnerType).toUpperCase();
  doc.font("Helvetica-Bold").fontSize(8.5);
  const bw = Math.min(P - 88, doc.widthOfString(badge, { characterSpacing: 1 }) + 22);
  doc.roundedRect(44, 256, bw, 22, 11).fill(RED);
  doc.fillColor("#ffffff").text(badge, 44, 263, { width: bw, align: "center", characterSpacing: 1 });

  doc.roundedRect(44, H - 196, 118, 118, 8).fill("#ffffff");
  doc.image(qr, 50, H - 190, { width: 106 });
  doc.fillColor("#aab3d6").font("Helvetica").fontSize(8.5).text("Scan to check this certificate is genuine and still valid.", 172, H - 160, { width: P - 196 });

  const x = P + 56;
  const w = W - x - 56;
  doc.fillColor(RED).font("Helvetica-Bold").fontSize(10.5).text("CERTIFICATE OF AUTHORISATION", x, 70, { characterSpacing: 2.5 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(12).text("This certifies that", x, 128);
  const name = latin(c.partnerName);
  doc.fillColor(NAVY).fontSize(fitName(doc, name, "Helvetica-Bold", 40, 20, w)).text(name, x, 150, { width: w });
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(`Partner ID  ${c.partnerId}`, x, 200, { characterSpacing: 1 });
  doc.fillColor(INK).font("Helvetica").fontSize(13).text(
    latin(`is an approved ${c.partnerType} of ${c.company} for ${c.solutionName}, authorised to present, demonstrate and refer it to clients.`),
    x, 236, { width: w, lineGap: 4 },
  );
  doc.rect(x, 318, 40, 3).fill(RED);

  const col = w / 3;
  detail(ctx, "Issued", fmt(c.issuedAt), x, 352, col - 10);
  detail(ctx, "Valid until", fmt(c.expiresAt), x + col, 352, col - 10);
  detail(ctx, "Certificate ID", c.publicId, x + col * 2, 352, col, NAVY);

  if (!signature(ctx, x, 446, 200)) doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(latin(c.company), x, 452, { width: w });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("Verify online: ", x, H - 58, { continued: true }).fillColor(NAVY).font("Helvetica-Bold").text(c.verifyUrl);
}

function seal(doc: Doc, cx: number, cy: number, r: number, code: string) {
  doc.circle(cx, cy, r).fill(NAVY);
  doc.lineWidth(3).strokeColor(RED).circle(cx, cy, r - 9).stroke();
  doc.lineWidth(0.8).strokeColor("#8b95c9").circle(cx, cy, r - 16).stroke();
  // Dots around the ring.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    doc.circle(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4), 1).fill("#8b95c9");
  }
  doc.fillColor("#aab3d6").font("Helvetica-Bold").fontSize(7.5).text("HIFI PARTNER STACK", cx - r, cy - 40, { width: r * 2, align: "center", characterSpacing: 1.5 });
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("AUTHORISED", cx - r, cy - 20, { width: r * 2, align: "center", characterSpacing: 1 });
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("PARTNER", cx - r, cy - 2, { width: r * 2, align: "center", characterSpacing: 1 });
  doc.rect(cx - 26, cy + 20, 52, 1.2).fill(RED);
  doc.fillColor("#aab3d6").font("Helvetica-Bold").fontSize(8).text(latin(code).toUpperCase().slice(0, 22), cx - r, cy + 28, { width: r * 2, align: "center", characterSpacing: 1 });
}

function academy(ctx: Ctx) {
  const { doc, c, qr, W, H } = ctx;
  doc.rect(0, 0, W, H).fill("#ffffff");
  // Faint rings behind the seal, then the colour bands on top of them.
  for (let i = 0; i < 6; i++) doc.lineWidth(0.6).strokeColor("#eef0f6").circle(W - 170, 230, 130 + i * 26).stroke();
  doc.rect(0, 0, W, 14).fill(RED);
  doc.rect(0, 14, W, 5).fill(NAVY);
  doc.rect(0, H - 8, W, 8).fill(NAVY);

  const x = 64;
  const l = logo();
  if (l) doc.image(l, x, 52, { width: 34 });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text("Hifi Partner Stack", l ? x + 44 : x, 58);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(latin(c.company), l ? x + 44 : x, 75);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(30).text("Certificate of Authorisation", x, 124);
  doc.fillColor(MUTED).font("Helvetica").fontSize(12).text("Awarded to", x, 178);
  const w = W - x - 300;
  const name = latin(c.partnerName);
  doc.fillColor(INK).fontSize(fitName(doc, name, "Helvetica-Bold", 38, 20, w)).text(name, x, 198, { width: w });
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(`Partner ID  ${c.partnerId}`, x, 246, { characterSpacing: 1 });
  doc.fillColor(INK).font("Helvetica").fontSize(12.5).text(latin(`in recognition of approval as an authorised ${c.partnerType} for`), x, 278, { width: w });
  doc.fillColor(RED).font("Helvetica-Bold").fontSize(24).text(latin(c.solutionName), x, 298, { width: w });

  seal(doc, W - 170, 230, 92, c.solutionName);

  const y = 400;
  detail(ctx, "Issued", fmt(c.issuedAt), x, y, 150);
  detail(ctx, "Valid until", fmt(c.expiresAt), x + 160, y, 150);
  detail(ctx, "Certificate ID", c.publicId, x + 320, y, 170, NAVY);
  signature(ctx, x, 482, 210);

  doc.image(qr, W - 154, H - 168, { width: 90 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("Scan to verify", W - 154, H - 74, { width: 90, align: "center" });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(c.verifyUrl, W - 420, H - 46, { width: 250, align: "right" });
}

function course(ctx: Ctx) {
  const { doc, c, qr, W, H } = ctx;
  const paper = "#fbf8f2";
  doc.rect(0, 0, W, H).fill(paper);
  doc.lineWidth(0.8).strokeColor("#e4dccb").rect(18, 18, W - 36, H - 36).stroke();

  // Ribbon on the right with a notched end and a badge.
  const rx = W - 214;
  const rw = 124;
  doc.save().moveTo(rx, 0).lineTo(rx + rw, 0).lineTo(rx + rw, 300).lineTo(rx + rw / 2, 276).lineTo(rx, 300).closePath().fill(NAVY).restore();
  doc.fillColor("#aab3d6").font("Helvetica-Bold").fontSize(8).text("HIFI PARTNER STACK", rx, 52, { width: rw, align: "center", characterSpacing: 1.2 });
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("PARTNER", rx, 82, { width: rw, align: "center", characterSpacing: 1.5 });
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("CERTIFICATE", rx, 100, { width: rw, align: "center", characterSpacing: 1.5 });
  const cx = rx + rw / 2;
  doc.circle(cx, 190, 44).fill(RED);
  doc.lineWidth(1.5).strokeColor("#ffffff").circle(cx, 190, 37).stroke();
  const l = logo();
  if (l) { doc.circle(cx, 190, 26).fill("#ffffff"); doc.image(l, cx - 18, 172, { width: 36 }); }
  else doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("H", cx - 20, 178, { width: 40, align: "center" });

  const x = 72;
  const w = rx - x - 40;
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text("HIFI PARTNER STACK", x, 60, { characterSpacing: 2.5 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(fmt(c.issuedAt), x, 80);

  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text("CERTIFICATE OF AUTHORISATION", x, 150, { characterSpacing: 2 });
  const name = latin(c.partnerName);
  doc.fillColor(INK).fontSize(fitName(doc, name, "Times-Bold", 46, 22, w)).text(name, x, 172, { width: w });
  doc.fillColor(MUTED).font("Helvetica").fontSize(12.5).text(latin(`has been approved as an authorised ${c.partnerType} for`), x, 236, { width: w });
  doc.fillColor(NAVY).font("Times-Bold").fontSize(28).text(latin(c.solutionName), x, 258, { width: w });
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(`Partner ID ${c.partnerId}   -   Valid until ${fmt(c.expiresAt)}`, x, 302, { width: w });

  if (!signature(ctx, x, 420, 220)) doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(latin(c.company), x, 426, { width: w });

  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("Verify at ", x, H - 76, { continued: true }).fillColor(NAVY).font("Helvetica-Bold").text(c.verifyUrl);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(`Certificate ID ${c.publicId}. This certificate can be revoked or expire; always verify it online.`, x, H - 62, { width: w + 60 });

  doc.image(qr, cx - 50, H - 190, { width: 100 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("Scan to verify", cx - 50, H - 86, { width: 100, align: "center" });
}

const DRAW: Record<CertificateDesign, (ctx: Ctx) => void> = { classic, modern, academy, course };

export async function certificatePdf(c: CertificateData): Promise<Buffer> {
  const qr = await QRCode.toBuffer(c.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: "M", color: { dark: "#1b2559", light: "#ffffff" } });
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: `Hifi Partner Stack certificate ${c.publicId}`, Author: c.company } });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  DRAW[c.design && isCertificateDesign(c.design) ? c.design : "classic"]({ doc, c, qr, W: doc.page.width, H: doc.page.height });
  doc.end();
  return done;
}
