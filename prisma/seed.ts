// Development seed. Creates the default organization, roles, permissions, company profile, example plans
// and a few DEMO users. Demo passwords are random and written to .data/dev-credentials.txt (git-ignored),
// never to source files. A real installation uses the /setup page instead (see docs/DEPLOYMENT.md).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import { seedBaseline, syncPermissionsAndRoles } from "../src/lib/bootstrap";

const db = new PrismaClient();

// The seed creates demo users and example prices. It must never run against production by accident.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("Refusing to seed in production. Set ALLOW_DEMO_SEED=1 only for a demo or staging environment.");
  process.exit(1);
}

// Illustrative seed plans from the spec. Prices are editable examples, and only
// AED is seeded: other currencies must be entered as their own prices, not converted.
const PLANS: { category: string; name: string; aed: number; popular?: boolean; features: string[] }[] = [
  { category: "Social Media Management", name: "Social Starter", aed: 799, features: ["3 social platforms", "10 posts per month", "Basic analytics", "Monthly report"] },
  { category: "Social Media Management", name: "Social Pro", aed: 1499, popular: true, features: ["All supported social platforms", "20 posts plus stories", "Paid ad management", "Advanced analytics", "Content strategy", "Weekly reports"] },
  { category: "Social Media Management", name: "Social Enterprise", aed: 2999, features: ["Full marketing suite", "Content volume per contract", "Full ad management", "Influencer marketing", "Dedicated account manager", "Real-time analytics"] },
  { category: "SaaS Products and Subscriptions", name: "ERP Basic", aed: 499, features: ["Lead management", "Contact database", "Email tracking", "Basic reports"] },
  { category: "SaaS Products and Subscriptions", name: "ERP Pro", aed: 999, popular: true, features: ["Full CRM features", "Sales pipeline", "Email automation", "Advanced analytics", "Tool integration", "5 user accounts"] },
  { category: "SaaS Products and Subscriptions", name: "ERP Enterprise", aed: 2999, features: ["Complete ERP solution", "Inventory management", "HR and payroll", "Financial management", "Custom modules", "Users per agreement"] },
];

async function seedPlans(orgId: string) {
  if ((await db.servicePlan.count({ where: { organizationId: orgId } })) > 0) return;
  const cats = new Map((await db.serviceCategory.findMany({ where: { organizationId: orgId } })).map((c) => [c.name, c.id]));
  for (const [i, p] of PLANS.entries()) {
    await db.servicePlan.create({
      data: {
        organizationId: orgId, categoryId: cats.get(p.category)!, name: p.name, isPopular: Boolean(p.popular), sortOrder: i,
        prices: { create: { currency: "AED", amount: p.aed } },
        features: { create: p.features.map((text, n) => ({ text, sortOrder: n })) },
      },
    });
  }
}

async function main() {
  let org = await db.organization.findFirst();
  if (!org) org = await db.organization.create({ data: { name: "Hifi Marketing and Technologies" } });

  await syncPermissionsAndRoles(db, org.id, { overwrite: true });

  // Branches (initial records, editable in Company Settings)
  await db.branch.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Registered Office, USA" } },
    update: {},
    create: { organizationId: org.id, name: "Registered Office, USA", kind: "REGISTERED_OFFICE", country: "US", address: "7901 4TH ST N, STE T, St. Petersburg, FL 33702, Florida, USA" },
  });
  const sales = await db.branch.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Sales Centre, Pakistan" } },
    update: {},
    create: { organizationId: org.id, name: "Sales Centre, Pakistan", kind: "SALES_CENTRE", country: "PK", address: "PZT Tower, adjacent to DHA Phase 1, Islamabad", timezone: "Asia/Karachi" },
  });

  if (!(await db.companyProfile.findFirst({ where: { organizationId: org.id } }))) {
    await db.companyProfile.create({
      data: {
        organizationId: org.id, isDefault: true, legalName: "Hifi Marketing and Technologies", globalUan: "+1 778-652-1616", localUan: "+92 316 8080801",
        registeredOffice: "7901 4TH ST N, STE T, St. Petersburg, FL 33702, Florida, USA", salesCentre: "PZT Tower, adjacent to DHA Phase 1, Islamabad",
        defaultCurrency: "USD", timezone: "Asia/Karachi",
      },
    });
  }

  await seedBaseline(db, org.id);
  await seedPlans(org.id);

  const demo = [
    { email: "admin@hifi.local", name: "Demo Super Admin", role: "SUPER_ADMIN" },
    { email: "finance@hifi.local", name: "Demo Finance Manager", role: "FINANCE_MANAGER" },
    { email: "sales@hifi.local", name: "Demo Sales Agent", role: "SALES_AGENT" },
  ];
  const lines: string[] = ["Hifi One local DEMO credentials (development only)", ""];
  for (const u of demo) {
    if (await db.user.findUnique({ where: { email: u.email } })) continue;
    const password = crypto.randomBytes(9).toString("base64url");
    const role = await db.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: u.role } } });
    await db.user.create({
      data: { organizationId: org.id, email: u.email, name: u.name, passwordHash: await bcrypt.hash(password, 12), branchId: sales.id, roles: { create: { roleId: role.id } } },
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
