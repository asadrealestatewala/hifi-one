// Development seed. Creates the default organization, roles, permissions,
// company profile, and a few DEMO users. Demo passwords are random and
// written to .data/dev-credentials.txt (git-ignored), never to source files.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import { PERMISSIONS, ROLE_DEFS, ALL_PERMISSIONS } from "../src/lib/permissions";

const db = new PrismaClient();

async function main() {
  let org = await db.organization.findFirst();
  if (!org) org = await db.organization.create({ data: { name: "Hifi Marketing and Technologies" } });

  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const perms = await db.permission.findMany();
  const permId = new Map(perms.map((p) => [p.key, p.id]));

  for (const def of ROLE_DEFS) {
    const role = await db.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key: def.key } },
      update: { name: def.name },
      create: { organizationId: org.id, key: def.key, name: def.name, isSystem: true },
    });
    const keys = def.permissions === "ALL" ? ALL_PERMISSIONS : def.permissions;
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: keys.map((k) => ({ roleId: role.id, permissionId: permId.get(k)! })),
    });
  }

  // Branches (initial records, editable in Company Settings)
  await db.branch.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Registered Office, USA" } },
    update: {},
    create: {
      organizationId: org.id,
      name: "Registered Office, USA",
      kind: "REGISTERED_OFFICE",
      country: "US",
      address: "7901 4TH ST N, STE T, St. Petersburg, FL 33702, Florida, USA",
    },
  });
  const sales = await db.branch.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Sales Centre, Pakistan" } },
    update: {},
    create: {
      organizationId: org.id,
      name: "Sales Centre, Pakistan",
      kind: "SALES_CENTRE",
      country: "PK",
      address: "PZT Tower, adjacent to DHA Phase 1, Islamabad",
      timezone: "Asia/Karachi",
    },
  });

  if (!(await db.companyProfile.findFirst({ where: { organizationId: org.id } }))) {
    await db.companyProfile.create({
      data: {
        organizationId: org.id,
        isDefault: true,
        legalName: "Hifi Marketing and Technologies",
        globalUan: "+1 778-652-1616",
        localUan: "+92 316 8080801",
        registeredOffice: "7901 4TH ST N, STE T, St. Petersburg, FL 33702, Florida, USA",
        salesCentre: "PZT Tower, adjacent to DHA Phase 1, Islamabad",
        defaultCurrency: "USD",
        timezone: "Asia/Karachi",
      },
    });
  }

  const demo = [
    { email: "admin@hifi.local", name: "Demo Super Admin", role: "SUPER_ADMIN" },
    { email: "finance@hifi.local", name: "Demo Finance Manager", role: "FINANCE_MANAGER" },
    { email: "sales@hifi.local", name: "Demo Sales Agent", role: "SALES_AGENT" },
  ];
  const lines: string[] = ["Hifi One local DEMO credentials (development only)", ""];
  for (const u of demo) {
    if (await db.user.findUnique({ where: { email: u.email } })) continue;
    const password = crypto.randomBytes(9).toString("base64url");
    const role = await db.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org.id, key: u.role } },
    });
    await db.user.create({
      data: {
        organizationId: org.id,
        email: u.email,
        name: u.name,
        passwordHash: await bcrypt.hash(password, 12),
        branchId: sales.id,
        roles: { create: { roleId: role.id } },
      },
    });
    lines.push(`${u.email}  (${u.role})  ${password}`);
  }
  if (lines.length > 2) {
    fs.mkdirSync(".data", { recursive: true });
    fs.writeFileSync(".data/dev-credentials.txt", lines.join("\n") + "\n");
    console.log("Demo users created. Credentials saved to .data/dev-credentials.txt");
  } else {
    console.log("Seed complete (demo users already existed).");
  }
}

main().finally(() => db.$disconnect());
