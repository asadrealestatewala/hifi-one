// Development seed. Creates the default organization, roles, permissions,
// company profile, and a few DEMO users. Demo passwords are random and
// written to .data/dev-credentials.txt (git-ignored), never to source files.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import { PERMISSIONS, ROLE_DEFS, ALL_PERMISSIONS } from "../src/lib/permissions";

const db = new PrismaClient();

// The seed creates demo users and example prices. It must never run against production by accident.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("Refusing to seed in production. Set ALLOW_DEMO_SEED=1 only for a demo or staging environment.");
  process.exit(1);
}

const CATEGORIES = [
  "Digital Marketing", "Social Media Management", "Video Editing and Production", "Graphic Design and Creative",
  "Website Design and Development", "Software Development", "AI Bots, Agents and Solutions", "SaaS Products and Subscriptions",
  "SEO Services", "Email Marketing", "Cold Calling and Telemarketing", "Lead Generation and Prospecting",
  "Meta Ads Management", "TikTok Ads Management", "YouTube Ads Management", "Google Ads and PPC",
  "Marketing Automation and CRM Setup", "Website Maintenance", "CGI, 3D and Animation", "Custom Projects and Other",
];

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

const STAGES: [string, number, boolean, boolean][] = [
  ["New", 10, false, false], ["Interested", 25, false, false], ["Follow-up", 35, false, false],
  ["Proposal Sent", 50, false, false], ["Negotiation", 70, false, false], ["Closed Won", 100, true, false],
  ["Closed Lost", 0, false, true], ["Not Interested", 0, false, true], ["Nurture", 5, false, false],
];

// Starter chart of accounts (editable; not tied to one jurisdiction).
const CHART: [string, string, string, string?][] = [
  ["1010", "Cash on Hand", "ASSET"], ["1200", "Accounts Receivable", "ASSET", "AR"], ["1300", "Prepayments", "ASSET"],
  ["1500", "Furniture and Equipment", "ASSET", "FIXED_ASSETS"], ["1510", "Investments", "ASSET", "INVESTMENTS"], ["1520", "Partnership and JV Balances", "ASSET"],
  ["1530", "Investment Income Receivable", "ASSET", "INVESTMENT_RECEIVABLE"], ["1590", "Accumulated Depreciation", "ASSET", "ACCUM_DEPRECIATION"],
  ["2000", "Accounts Payable", "LIABILITY", "ACCOUNTS_PAYABLE"], ["2100", "Customer Advances", "LIABILITY", "CUSTOMER_ADVANCES"],
  ["2200", "Tax Payable", "LIABILITY", "TAX_PAYABLE"], ["2300", "Accrued Expenses", "LIABILITY"],
  ["2400", "Deferred Revenue", "LIABILITY"], ["2500", "Payroll Liabilities", "LIABILITY", "PAYROLL_PAYABLE"], ["2510", "Payroll Tax Withheld", "LIABILITY", "PAYROLL_TAX"],
  ["3000", "Owner's Equity", "EQUITY"], ["3100", "Retained Earnings", "EQUITY"],
  ["4000", "Service Revenue", "REVENUE", "REVENUE_SERVICE"], ["4010", "SaaS Revenue", "REVENUE"],
  ["4020", "Advertising Management Revenue", "REVENUE"],
  ["5000", "Direct Labor and Contractors", "DIRECT_COST"], ["5010", "Direct Software and Hosting", "DIRECT_COST"],
  ["6000", "Marketing Expense", "OPEX"], ["6010", "Rent and Utilities", "OPEX"], ["6020", "Salaries and Commissions", "OPEX", "PAYROLL_EXPENSE"],
  ["6030", "Taxes", "OPEX"], ["6040", "Depreciation", "OPEX", "DEPRECIATION_EXPENSE"],
  ["7000", "Investment Income", "OTHER_INCOME", "INVESTMENT_INCOME"], ["7100", "Gain on Asset Disposal", "OTHER_INCOME", "GAIN_DISPOSAL"], ["8000", "Other Expenses", "OTHER_EXPENSE"], ["8100", "Loss on Asset Disposal", "OTHER_EXPENSE", "LOSS_DISPOSAL"],
];

async function seedChart(orgId: string) {
  for (const [code, name, type, systemKey] of CHART) {
    await db.account.upsert({
      where: { organizationId_code: { organizationId: orgId, code } },
      update: systemKey ? { systemKey } : {},
      create: { organizationId: orgId, code, name, type, systemKey: systemKey ?? null },
    });
  }
}

async function seedCatalog(orgId: string) {
  const cats = new Map<string, string>();
  for (const [i, name] of CATEGORIES.entries()) {
    const c = await db.serviceCategory.upsert({
      where: { organizationId_name: { organizationId: orgId, name } },
      update: {},
      create: { organizationId: orgId, name, sortOrder: i },
    });
    cats.set(name, c.id);
  }
  if ((await db.servicePlan.count({ where: { organizationId: orgId } })) === 0) {
    for (const [i, p] of PLANS.entries()) {
      await db.servicePlan.create({
        data: {
          organizationId: orgId,
          categoryId: cats.get(p.category)!,
          name: p.name,
          isPopular: Boolean(p.popular),
          sortOrder: i,
          prices: { create: { currency: "AED", amount: p.aed } },
          features: { create: p.features.map((text, n) => ({ text, sortOrder: n })) },
        },
      });
    }
  }
  for (const [i, [name, probability, isWon, isLost]] of STAGES.entries()) {
    await db.pipelineStage.upsert({
      where: { organizationId_name: { organizationId: orgId, name } },
      update: {},
      create: { organizationId: orgId, name, sortOrder: i, probability, isWon, isLost },
    });
  }
}

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

  await seedCatalog(org.id);
  await seedChart(org.id);
  for (const [name, days, paid] of [["Annual", 14, true], ["Casual", 8, true], ["Sick", 8, true], ["Unpaid", 0, false]] as const) {
    await db.leaveType.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {}, create: { organizationId: org.id, name, daysPerYear: days, paid },
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
