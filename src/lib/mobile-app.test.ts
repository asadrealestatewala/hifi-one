import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APK_PUBLIC_PATH, resolveApkSource } from "./mobile-app";

describe("resolveApkSource", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apk-"));
  it("is null when nothing is published", () => {
    expect(resolveApkSource({}, dir)).toBeNull();
  });
  it("uses an https ANDROID_APK_URL and ignores other schemes", () => {
    expect(resolveApkSource({ ANDROID_APK_URL: "https://x.test/a.apk" }, dir)?.url).toBe("https://x.test/a.apk");
    expect(resolveApkSource({ ANDROID_APK_URL: "http://x.test/a.apk" }, dir)).toBeNull();
    expect(resolveApkSource({ ANDROID_APK_URL: "javascript:alert(1)" }, dir)).toBeNull();
  });
  it("serves a local file only when it exists and is not empty", () => {
    fs.mkdirSync(path.join(dir, "downloads"));
    fs.writeFileSync(path.join(dir, APK_PUBLIC_PATH), "");
    expect(resolveApkSource({}, dir)).toBeNull();
    fs.writeFileSync(path.join(dir, APK_PUBLIC_PATH), Buffer.alloc(2 * 1048576));
    expect(resolveApkSource({}, dir)).toEqual({ url: APK_PUBLIC_PATH, sizeMb: 2 });
  });
});

describe("the install route", () => {
  it("is a public GET that only redirects to the resolved source", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../app/api/app/android/route.ts"), "utf8");
    expect(src).toContain("resolveApkSource(");
    expect(src).not.toMatch(/prisma|@\/lib\/db|export (async )?function (POST|PUT|PATCH|DELETE)/);
  });
});
