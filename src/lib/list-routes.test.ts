// Each list's CSV route must ask for exactly the permission its list does, and go through listExport
// (which checks it again and applies the person's record scope), so a download never shows more than the screen.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const app = path.resolve(__dirname, "..", "app", "(app)");
const ROUTES: Record<string, { key: string; permission: string }> = {
  "finance/invoices": { key: "invoices", permission: "finance.view" },
  "finance/payments": { key: "payments", permission: "finance.view" },
  leads: { key: "leads", permission: "crm.view" },
  quotes: { key: "quotes", permission: "quotes.view" },
  expenses: { key: "expenses", permission: "self.expense" },
  "audit-logs": { key: "audit", permission: "audit.view" },
};

describe("list export routes", () => {
  for (const [dir, r] of Object.entries(ROUTES)) {
    it(`${dir}/export uses the list's permission`, () => {
      const page = fs.readFileSync(path.join(app, dir, "page.tsx"), "utf8");
      const route = fs.readFileSync(path.join(app, dir, "export", "route.ts"), "utf8");
      expect(page).toContain(`requirePermission("${r.permission}")`);
      expect(route).toContain(`requirePermission("${r.permission}")`);
      expect(route).toContain(`listExport(db, "${r.key}", user,`);
      expect(page).toContain(`${dir}/export`);
    });
  }
  it("matches the permissions the list library enforces", async () => {
    const lists = fs.readFileSync(path.resolve(__dirname, "lists.ts"), "utf8");
    for (const r of Object.values(ROUTES)) expect(lists).toMatch(new RegExp(`${r.key}: \{ permission: "${r.permission.replace(".", "\.")}"`));
  });
});
