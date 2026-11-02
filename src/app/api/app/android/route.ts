import { NextResponse } from "next/server";
import { resolveApkSource } from "@/lib/mobile-app";

// Public by design: the install button on /site/app. Redirects to the published APK, or says it is not published.
// The Location is the path itself (or the https link), never rebuilt from the request URL: behind the reverse proxy
// that URL is http://localhost:3000, which would send phones to their own localhost.
export function GET(): NextResponse {
  const apk = resolveApkSource();
  if (!apk) return new NextResponse("The Android app is not published yet.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(null, { status: 307, headers: { Location: apk.url, "Cache-Control": "no-store" } });
}
