// Where the Android app (APK) for the website's install button comes from. Nothing is faked: with no
// published file the page says so instead of showing a dead button.
import fs from "node:fs";
import path from "node:path";

export const APK_PUBLIC_PATH = "/downloads/hifi-one.apk";

export type ApkSource = { url: string; sizeMb: number | null } | null;

// ANDROID_APK_URL (an https link, for example a GitHub release asset) wins; otherwise a file placed at
// public/downloads/hifi-one.apk is served by the site itself.
export function resolveApkSource(env: Record<string, string | undefined> = process.env, publicDir = path.join(process.cwd(), "public")): ApkSource {
  const url = env.ANDROID_APK_URL?.trim();
  if (url && /^https:\/\//i.test(url)) return { url, sizeMb: null };
  try {
    const st = fs.statSync(path.join(publicDir, APK_PUBLIC_PATH));
    if (st.isFile() && st.size > 0) return { url: APK_PUBLIC_PATH, sizeMb: Math.round((st.size / 1048576) * 10) / 10 };
  } catch {
    /* not published */
  }
  return null;
}
