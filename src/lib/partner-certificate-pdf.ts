// The Hifi Partner Stack certificate: one landscape A4 page with the partner's name, the Solution, issue and expiry dates,
// the Partner ID, a unique certificate id and a QR code that opens the public verification page. A training certificate uses
// the Course design, the official one the Academy design. Takes plain data and returns the file as a Buffer.
// The standard PDF fonts cover Western European letters only; any other character is printed as "?" rather than wrongly.
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/** TRAINING: given when the partner finishes training on a Solution; never expires. AUTHORISATION: the certificate of authorisation. */
export type CertificateKind = "TRAINING" | "AUTHORISATION";
export const CERTIFICATE_KINDS: { key: CertificateKind; label: string; design: string; hint: string }[] = [
  { key: "TRAINING", label: "Training certificate", design: "Course design", hint: "Given when the partner finishes training on a Solution. Does not expire." },
  { key: "AUTHORISATION", label: "Certificate of authorisation", design: "Academy design", hint: "The authorisation to sell a Solution. Needs a training certificate first; expires and is renewed." },
];
export const isCertificateKind = (v: string): v is CertificateKind => v === "TRAINING" || v === "AUTHORISATION";

export type CertificateData = {
  publicId: string;
  partnerId: string;
  partnerName: string;
  solutionName: string;
  partnerType: string;
  issuedAt: Date;
  expiresAt: Date | null;
  verifyUrl: string;
  company: string;
  kind: CertificateKind;
  /** Optional person who signs for the programme; left out of the page when empty. */
  signatoryName?: string;
  signatoryTitle?: string;
};

const latin = (s: string) => s.replace(/[^ -~ -ÿ]/g, "?");
const fmt = (d: Date | null) => !d ? "Does not expire" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

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
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("TRAINING", rx, 82, { width: rw, align: "center", characterSpacing: 1.5 });
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
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(`Completed ${fmt(c.issuedAt)}`, x, 80);

  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text("CERTIFICATE OF TRAINING", x, 150, { characterSpacing: 2 });
  const name = latin(c.partnerName);
  doc.fillColor(INK).fontSize(fitName(doc, name, "Times-Bold", 46, 22, w)).text(name, x, 172, { width: w });
  doc.fillColor(MUTED).font("Helvetica").fontSize(12.5).text("has successfully completed partner training on", x, 236, { width: w });
  doc.fillColor(NAVY).font("Times-Bold").fontSize(28).text(latin(c.solutionName), x, 258, { width: w });
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(latin(`Partner ID ${c.partnerId}   -   ${c.partnerType}`), x, 302, { width: w });

  if (!signature(ctx, x, 420, 220)) doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(latin(c.company), x, 426, { width: w });

  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("Verify at ", x, H - 76, { continued: true }).fillColor(NAVY).font("Helvetica-Bold").text(c.verifyUrl);
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(`Certificate ID ${c.publicId}. Training certificates do not authorise selling on their own; always verify online.`, x, H - 62, { width: w + 60 });

  doc.image(qr, cx - 50, H - 190, { width: 100 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("Scan to verify", cx - 50, H - 86, { width: 100, align: "center" });
}


export async function certificatePdf(c: CertificateData): Promise<Buffer> {
  const qr = await QRCode.toBuffer(c.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: "M", color: { dark: "#1b2559", light: "#ffffff" } });
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: `Hifi Partner Stack certificate ${c.publicId}`, Author: c.company } });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  (c.kind === "TRAINING" ? course : academy)({ doc, c, qr, W: doc.page.width, H: doc.page.height });
  doc.end();
  return done;
}
