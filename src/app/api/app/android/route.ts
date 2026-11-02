import { NextRequest, NextResponse } from "next/server";
import { resolveApkSource } from "@/lib/mobile-app";

// Public by design: the install button on /site/app. Redirects to the published APK, or says it is not published.
export function GET(req: NextRequest): NextResponse {
  const apk = resolveApkSource();
  if (!apk) return new NextResponse("The Android app is not published yet.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.redirect(new URL(apk.url, req.url), { status: 307, headers: { "Cache-Control": "no-store" } });
}
