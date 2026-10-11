import { NextResponse } from "next/server";

// A PDF download response. The filename is cleaned, and the browser is told not to guess types or cache private documents.
export function pdfResponse(bytes: Buffer, filename: string, inline = true) {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "document";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export const notFound = () => new NextResponse("Not found", { status: 404 });
