// The Hifi Partner Stack certificate: one landscape A4 page with the partner's name, the Solution, issue and expiry dates,
// a unique id and a QR code that opens the public verification page. Takes plain data and returns the file as a Buffer.
// The standard PDF fonts cover Western European letters only; any other character is printed as "?" rather than wrongly.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

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
};

const latin = (s: string) => s.replace(/[^ -~ -ÿ]/g, "?");
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export async function certificatePdf(c: CertificateData): Promise<Buffer> {
  const qr = await QRCode.toBuffer(c.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: `Hifi Partner Stack certificate ${c.publicId}`, Author: c.company } });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const H = doc.page.height;
  const navy = "#1b2559";
  const red = "#e11d1d";

  doc.rect(0, 0, W, H).fill("#ffffff");
  doc.lineWidth(3).strokeColor(navy).rect(24, 24, W - 48, H - 48).stroke();
  doc.lineWidth(1).strokeColor(red).rect(32, 32, W - 64, H - 64).stroke();

  doc.fillColor(red).font("Helvetica-Bold").fontSize(12).text("HIFI PARTNER STACK", 0, 66, { width: W, align: "center", characterSpacing: 3 });
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(34).text("Certificate of Authorisation", 0, 92, { width: W, align: "center" });
  doc.fillColor("#555555").font("Helvetica").fontSize(13).text("This certifies that", 0, 158, { width: W, align: "center" });
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(32).text(latin(c.partnerName), 60, 184, { width: W - 120, align: "center" });
  doc.fillColor("#666666").font("Helvetica").fontSize(10).text(`Partner ID ${c.partnerId}`, 0, 222, { width: W, align: "center", characterSpacing: 1 });
  doc.strokeColor("#cccccc").lineWidth(0.8).moveTo(W / 2 - 160, 238).lineTo(W / 2 + 160, 238).stroke();
  doc.fillColor("#555555").font("Helvetica").fontSize(13).text(`is an authorised ${latin(c.partnerType)} for`, 0, 250, { width: W, align: "center" });
  doc.fillColor(red).font("Helvetica-Bold").fontSize(26).text(latin(c.solutionName), 0, 272, { width: W, align: "center" });

  doc.fillColor("#333333").font("Helvetica").fontSize(11);
  doc.text("Issued", 70, 380); doc.font("Helvetica-Bold").text(fmt(c.issuedAt), 70, 396);
  doc.font("Helvetica").text("Valid until", 70, 424); doc.font("Helvetica-Bold").text(fmt(c.expiresAt), 70, 440);
  doc.font("Helvetica").text("Certificate ID", 270, 380); doc.font("Helvetica-Bold").text(c.publicId, 270, 396);
  doc.font("Helvetica").fontSize(9).fillColor("#666666").text("Check this certificate is genuine and still valid by scanning the code, or open:", 270, 424, { width: 300 });
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(c.verifyUrl, 270, 448, { width: 300 });

  doc.image(qr, W - 190, 360, { width: 110 });
  doc.fillColor("#666666").font("Helvetica").fontSize(8).text("Scan to verify", W - 190, 474, { width: 110, align: "center" });
  doc.fillColor("#888888").font("Helvetica").fontSize(9).text(latin(`${c.company}. This certificate can be revoked or expire; always verify it online.`), 0, H - 62, { width: W, align: "center" });
  doc.end();
  return done;
}
