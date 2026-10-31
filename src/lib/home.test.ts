import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { homeDestination } from "./home";

describe("the home address", () => {
  it("sends a signed-in person to the ERP", () => {
    expect(homeDestination({ setupNeeded: false, signedIn: true })).toBe("/dashboard");
  });
  it("shows a signed-out visitor the public website, never the ERP", () => {
    expect(homeDestination({ setupNeeded: false, signedIn: false })).toBe("website");
  });
  it("opens first-run setup on a new installation, signed in or not", () => {
    expect(homeDestination({ setupNeeded: true, signedIn: false })).toBe("/setup");
    expect(homeDestination({ setupNeeded: true, signedIn: true })).toBe("/setup");
  });
  it("decides on the server from the real session and serves the website home page", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../app/route.ts"), "utf8");
    expect(src).toContain("getSessionUser()");
    expect(src).toContain("needsSetup(db)");
    expect(src).toContain("homeDestination(");
    expect(src).toContain('sitePage("index"');
    expect(src).toContain('dynamic = "force-dynamic"');
  });
});
