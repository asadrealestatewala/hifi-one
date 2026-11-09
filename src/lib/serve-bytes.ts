// Sends stored bytes with the right headers, including Range requests so a browser can play and seek a video.
import { NextResponse } from "next/server";

type Opts = { contentType: string; filename: string; inline: boolean; cache?: string };

// PDFs and plain pictures and videos are shown by the browser's own viewer; anything else (notably SVG) is served sandboxed and inert.
const needsSandbox = (t: string) => !(t === "application/pdf" || t.startsWith("video/") || (t.startsWith("image/") && t !== "image/svg+xml"));

export function serveBytes(req: Request, bytes: Buffer, o: Opts): NextResponse {
  const total = bytes.length;
  const headers: Record<string, string> = {
    "Content-Type": o.contentType, // chosen by the server when the file was uploaded
    "Accept-Ranges": "bytes",
    "Content-Disposition": `${o.inline ? "inline" : "attachment"}; filename="${o.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(o.filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": o.cache ?? "private, no-store",
  };
  if (needsSandbox(o.contentType)) headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : total - 1;
    end = Math.min(end, total - 1);
    if (start > end || start >= total) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    start = Math.max(0, start);
    const part = bytes.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(part), { status: 206, headers: { ...headers, "Content-Length": String(part.length), "Content-Range": `bytes ${start}-${end}/${total}` } });
  }
  return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(total) } });
}
