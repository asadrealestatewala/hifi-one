// Baseline data every installation needs (roles, permissions, chart of accounts, pipeline stages, leave types)
// and the one-time first-run setup. Shared by the development seed and the /setup page.
// Free of Next.js imports so it can be tested against the database.
import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_DEFS } from "./permissions";

export class SetupError extends Error {}

export const SERVICE_CATEGORIES = [
  "Digital Marketing", "Social Media Management", "Video Editing and Production", "Graphic Design and Creative",
  "Website Design and Development", "Software Development", "AI Bots, Agents and Solutions", "SaaS Products and Subscriptions",
  "SEO Services", "Email Marketing", "Cold Calling and Telemarketing", "Lead Generation and Prospecting",
  "Meta Ads Management", "TikTok Ads Management", "YouTube Ads Management", "Google Ads and PPC",
  "Marketing Automation and CRM Setup", "Website Maintenance", "CGI, 3D and Animation", "Custom Projects and Other",
];

export const PIPELINE_STAGES: [string, number, boolean, boolean][] = [
  ["New", 10, false, false], ["Interested", 25, false, false], ["Follow-up", 35, false, false],
  ["Proposal Sent", 50, false, false], ["Negotiation", 70, false, false], ["Closed Won", 100, true, false],
  ["Closed Lost", 0, false, true], ["Not Interested", 0, false, true], ["Nurture", 5, false, false],
];

// Starter chart of accounts (editable; not tied to one jurisdiction). Accounts with a system key are used by automatic postings.
export const CHART: [string, string, string, string?][] = [
  ["1010", "Cash on Hand", "ASSET"], ["1200", "Accounts Receivable", "ASSET", "AR"], ["1300", "Prepayments", "ASSET"],
  ["1500", "Furniture and Equipment", "ASSET", "FIXED_ASSETS"], ["1510", "Investments", "ASSET", "INVESTMENTS"], ["1520", "Partnership and JV Balances", "ASSET"],
  ["1530", "Investment Income Receivable", "ASSET", "INVESTMENT_RECEIVABLE"], ["1590", "Accumulated Depreciation", "ASSET", "ACCUM_DEPRECIATION"],
  ["2000", "Accounts Payable", "LIABILITY", "ACCOUNTS_PAYABLE"], ["2100", "Customer Advances", "LIABILITY", "CUSTOMER_ADVANCES"],
  ["2200", "Tax Payable", "LIABILITY", "TAX_PAYABLE"], ["2300", "Accrued Expenses", "LIABILITY"],
  ["2400", "Deferred Revenue", "LIABILITY"], ["2500", "Payroll Liabilities", "LIABILITY", "PAYROLL_PAYABLE"], ["2510", "Payroll Tax Withheld", "LIABILITY", "PAYROLL_TAX"],
  ["3000", "Owner's Equity", "EQUITY"], ["3100", "Retained Earnings", "EQUITY", "RETAINED_EARNINGS"],
  ["4000", "Service Revenue", "REVENUE", "REVENUE_SERVICE"], ["4010", "SaaS Revenue", "REVENUE"], ["4020", "Advertising Management Revenue", "REVENUE"],
  ["5000", "Direct Labor and Contractors", "DIRECT_COST"], ["5010", "Direct Software and Hosting", "DIRECT_COST"],
  ["6000", "Marketing Expense", "OPEX"], ["6010", "Rent and Utilities", "OPEX"], ["6020", "Salaries and Commissions", "OPEX", "PAYROLL_EXPENSE"],
  ["6030", "Taxes", "OPEX"], ["6040", "Depreciation", "OPEX", "DEPRECIATION_EXPENSE"], ["6050", "Bad Debt Expense", "OPEX", "BAD_DEBT"],
  ["7000", "Investment Income", "OTHER_INCOME", "INVESTMENT_INCOME"], ["7100", "Gain on Asset Disposal", "OTHER_INCOME", "GAIN_DISPOSAL"],
  ["8000", "Other Expenses", "OTHER_EXPENSE"], ["8100", "Loss on Asset Disposal", "OTHER_EXPENSE", "LOSS_DISPOSAL"],
];

export const LEAVE_TYPES: [string, number, boolean][] = [["Annual", 14, true], ["Casual", 8, true], ["Sick", 8, true], ["Unpaid", 0, false]];

// Permissions are global. Roles are per organization; with overwrite the system roles are reset to the
// definitions in code (used by the development seed). A real installation keeps edits made in the Roles screen.
export async function syncPermissionsAndRoles(db: Db, organizationId: string, opts: { overwrite: boolean }) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const permId = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));
  for (const def of ROLE_DEFS) {
    const existing = await db.role.findUnique({ where: { organizationId_key: { organizationId, key: def.key } } });
    const role = existing ?? (await db.role.create({ data: { organizationId, key: def.key, name: def.name, isSystem: true } }));
    if (existing && !opts.overwrite) {
      // New permissions that Super Admin should always hold are added even without overwrite
      if (def.permissions !== "ALL") continue;
    }
    const keys = def.permissions === "ALL" ? ALL_PERMISSIONS : def.permissions;
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: keys.map((k) => ({ roleId: role.id, permissionId: permId.get(k)! })) });
  }
}

export async function seedBaseline(db: Db, organizationId: string) {
  for (const [code, name, type, systemKey] of CHART) {
    await db.account.upsert({
      where: { organizationId_code: { organizationId, code } },
      update: systemKey ? { systemKey } : {},
      create: { organizationId, code, name, type, systemKey: systemKey ?? null },
    });
  }
  for (const [i, [name, probability, isWon, isLost]] of PIPELINE_STAGES.entries()) {
    await db.pipelineStage.upsert({
      where: { organizationId_name: { organizationId, name } }, update: {}, create: { organizationId, name, sortOrder: i, probability, isWon, isLost },
    });
  }
  for (const [i, name] of SERVICE_CATEGORIES.entries()) {
    await db.serviceCategory.upsert({ where: { organizationId_name: { organizationId, name } }, update: {}, create: { organizationId, name, sortOrder: i } });
  }
  for (const [name, days, paid] of LEAVE_TYPES) {
    await db.leaveType.upsert({ where: { organizationId_name: { organizationId, name } }, update: {}, create: { organizationId, name, daysPerYear: days, paid } });
  }
}

export async function needsSetup(db: PrismaClient): Promise<boolean> {
  return (await db.user.count()) === 0;
}

export function checkPassword(pw: string) {
  if (pw.length < 12) throw new SetupError("Use a password of at least 12 characters for the first administrator.");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) throw new SetupError("Include upper case, lower case and a number.");
}

// Creates the organization and the first Super Admin. Only works while the database has no users at all.
// In production a setup token from the environment must also match, so a stranger who reaches the page first cannot take over.
export async function firstSetup(
  db: PrismaClient,
  p: { companyName: string; adminName: string; adminEmail: string; password: string; timezone?: string; currency?: string; setupToken?: string; expectedToken?: string },
) {
  if (p.expectedToken !== undefined && p.setupToken !== p.expectedToken) throw new SetupError("The setup token is not correct.");
  const email = p.adminEmail.trim().toLowerCase();
  if (p.companyName.trim().length < 2) throw new SetupError("Enter the company name.");
  if (p.adminName.trim().length < 2) throw new SetupError("Enter the administrator's name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SetupError("Enter a valid email address.");
  checkPassword(p.password);
  const passwordHash = await bcrypt.hash(p.password, 12);
  // One transaction for everything: either the whole installation is created, or nothing is.
  return db.$transaction(
    async (tx) => {
      // Only one setup can run at a time; a second one waits, then sees the first one's users and stops
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
      if ((await tx.user.count()) > 0) throw new SetupError("This system is already set up. Sign in instead.");
      const org = await tx.organization.create({ data: { name: p.companyName.trim() } });
      await tx.companyProfile.create({
        data: { organizationId: org.id, isDefault: true, legalName: p.companyName.trim(), defaultCurrency: p.currency ?? "USD", timezone: p.timezone ?? "UTC" },
      });
      await syncPermissionsAndRoles(tx, org.id, { overwrite: true });
      await seedBaseline(tx, org.id);
      const role = await tx.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: "SUPER_ADMIN" } } });
      const user = await tx.user.create({ data: { organizationId: org.id, email, name: p.adminName.trim(), passwordHash, roles: { create: { roleId: role.id } } } });
      await tx.auditLog.create({ data: { organizationId: org.id, actorId: user.id, action: "system.first_setup", entity: "Organization", entityId: org.id } });
      return { organization: org, user };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}
