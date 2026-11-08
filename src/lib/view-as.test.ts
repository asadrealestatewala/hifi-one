import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canPreviewRole, previewPermissions } from "./view-as";
import { ROLE_DEFS } from "./permissions";

describe("view as role", () => {
  it("never previews Super Admin or portal roles", () => {
    for (const k of ["SUPER_ADMIN", "CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"]) expect(canPreviewRole(k)).toBe(false);
    expect(canPreviewRole("SALES_AGENT")).toBe(true);
    expect(canPreviewRole("ONBOARDING_SPECIALIST")).toBe(true);
  });
  it("gives the role's permissions, nothing more than the real ones", () => {
    const real = new Set(["a", "b"]);
    expect([...previewPermissions(real, ["b", "c"])]).toEqual(["b"]);
    expect(previewPermissions(new Set<string>(), ["a"]).size).toBe(0);
  });
  it("a Sales Agent preview does not include finance or user administration", () => {
    const all = new Set(ROLE_DEFS.flatMap((r) => (r.permissions === "ALL" ? [] : r.permissions)));
    const agent = ROLE_DEFS.find((r) => r.key === "SALES_AGENT")!.permissions as string[];
    const seen = previewPermissions(all as Set<string>, agent);
    expect(seen.has("crm.edit")).toBe(true);
    expect(seen.has("users.manage" as never)).toBe(false);
    expect(seen.has("finance.post")).toBe(false);
  });
  it("the server honours the preview only for a real Super Admin, bound to that person's own id, and keeps their two-step facts", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "auth.ts"), "utf8");
    const body = src.slice(src.indexOf("async function loadSessionUser"), src.indexOf("export async function viewAsToken"));
    expect(body).toContain("!base.realSuperAdmin");
    expect(body).toContain("payload.uid !== base.id");
    expect(body).toContain("previewPermissions(base.permissions");
    expect(body).not.toContain("mfaRequired");
    const actions = fs.readFileSync(path.resolve(__dirname, "../app/(app)/view-as/actions.ts"), "utf8");
    expect(actions.match(/!user\.realSuperAdmin\) redirect\("\/forbidden"\)/g)?.length).toBe(2);
  });
});
