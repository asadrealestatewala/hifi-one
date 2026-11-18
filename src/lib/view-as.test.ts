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
    const body = src.slice(src.indexOf("async function loadSessionUser"), src.indexOf("async function personView"));
    expect(body).toContain("!base.realSuperAdmin");
    expect(body).toContain("payload.uid !== base.id");
    expect(body).toContain("previewPermissions(base.permissions");
    expect(body).not.toContain("mfaRequired");
    const actions = fs.readFileSync(path.resolve(__dirname, "../app/(app)/view-as/actions.ts"), "utf8");
    expect(actions.match(/!user\.realSuperAdmin\) redirect\("\/forbidden"\)/g)?.length).toBe(2);
  });
});

import { VIEW_AS_USER_COOKIE, READ_METHODS, canViewAsUser, isClosedWhileViewing, isEndViewRequest, homePathForView } from "./view-as";

describe("view as a person", () => {
  it("never opens a Super Admin, yourself or a switched-off account", () => {
    expect(canViewAsUser("a", { id: "b", active: true, isSuperAdmin: false })).toBe(true);
    expect(canViewAsUser("a", { id: "a", active: true, isSuperAdmin: false })).toBe(false);
    expect(canViewAsUser("a", { id: "b", active: true, isSuperAdmin: true })).toBe(false);
    expect(canViewAsUser("a", { id: "b", active: false, isSuperAdmin: false })).toBe(false);
  });
  it("keeps passwords, two-step set-up and private chats closed, and allows only ending the view to write", () => {
    for (const p of ["/account/password", "/account/security", "/chat", "/chat/x", "/api/chat/messages"]) expect(isClosedWhileViewing(p)).toBe(true);
    expect(isClosedWhileViewing("/portal")).toBe(false);
    expect(isEndViewRequest("/view-as/stop")).toBe(true);
    expect(isEndViewRequest("/users")).toBe(false);
    expect(READ_METHODS.has("POST")).toBe(false);
    expect(READ_METHODS.has("GET")).toBe(true);
  });
  it("lands each person type on its own home", () => {
    expect(homePathForView("CLIENT")).toBe("/portal");
    expect(homePathForView("VENDOR")).toBe("/vendor");
    expect(homePathForView("PARTNER")).toBe("/partner");
    expect(homePathForView("EMPLOYEE")).toBe("/dashboard");
  });
  it("the server honours it only for a real Super Admin's own cookie, drops pending password and two-step, and files audit under the admin", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "auth.ts"), "utf8");
    const body = src.slice(src.indexOf("async function personView"), src.indexOf("export async function viewAsUserToken"));
    expect(body).toContain('payload.uid !== admin.id');
    expect(body).toContain("canViewAsUser");
    expect(body).toContain("mustChangePassword: false");
    expect(src).toContain("actorId: v ? v.adminId : user.id");
    expect(src.slice(src.indexOf("async function loadSessionUser"), src.indexOf("async function personView"))).toContain("!base.realSuperAdmin");
  });
  it("the middleware refuses every write while the cookie is present", () => {
    const mw = fs.readFileSync(path.resolve(__dirname, "..", "middleware.ts"), "utf8");
    expect(mw).toContain(VIEW_AS_USER_COOKIE.length ? "VIEW_AS_USER_COOKIE" : "");
    expect(mw).toContain("READ_METHODS.has(req.method)");
    expect(mw).toContain("status: 403");
  });
});
