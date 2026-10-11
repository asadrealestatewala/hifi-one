// Generates docs/ROLES.md from the single source of truth in src/lib/permissions.ts.
import fs from "node:fs";
import { PERMISSIONS, ROLE_DEFS, ALL_PERMISSIONS } from "../src/lib/permissions";

const keys = ALL_PERMISSIONS as string[];
const lines: string[] = [
  "# Roles and permissions matrix",
  "",
  "Generated from `src/lib/permissions.ts` by `npm run docs:roles`. Do not edit by hand.",
  "A role grants a permission when it is listed; Super Admin holds every permission. Record-level rules (for example, sales agents see only their own leads) are enforced in addition to these permissions.",
  "",
  "## Permissions",
  "",
  "| Permission | What it allows |",
  "|---|---|",
  ...keys.map((k) => `| \`${k}\` | ${(PERMISSIONS as Record<string, string>)[k]} |`),
  "",
  "## Roles",
  "",
];
for (const r of ROLE_DEFS) {
  const perms = r.permissions === "ALL" ? keys : (r.permissions as string[]);
  lines.push(`### ${r.name}`, "", perms.length ? perms.map((p) => `\`${p}\``).join(", ") : "No internal permissions. Uses a separate portal with data scoped to their own organization.", "");
}
fs.writeFileSync("docs/ROLES.md", lines.join("\n"));
console.log(`Wrote docs/ROLES.md (${ROLE_DEFS.length} roles, ${keys.length} permissions)`);
