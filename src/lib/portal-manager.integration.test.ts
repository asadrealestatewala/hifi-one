import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { portalManager, portalProject } from "./portal";
import { statementCsv } from "./ledger-csv";
import type { StatementDoc } from "./pdf";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, pm: string, projManager: string, withPm: string, without: string, other: string, project: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "EmployeeProfile","Project","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Mgr Org" } })).id;
  const u = async (n: string) => (await db.user.create({ data: { organizationId: org, email: `${n}@m.test`, name: n, passwordHash: "x", phone: n === "Pam PM" ? "0300111" : "0300222" } })).id;
  [pm, projManager] = await Promise.all([u("Pam PM"), u("Mo Manager")]);
  await db.employeeProfile.create({ data: { organizationId: org, userId: pm, employeeNo: "HFT-007" } });
  withPm = (await db.client.create({ data: { organizationId: org, name: "A", currency: "USD", projectManagerId: pm } })).id;
  without = (await db.client.create({ data: { organizationId: org, name: "B", currency: "USD" } })).id;
  other = (await db.client.create({ data: { organizationId: org, name: "C", currency: "USD" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "P-1", name: "App", clientId: without, managerId: projManager } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("portal project manager", () => {
  it("shows the client's allocated manager with name and ID only", async () => {
    const m = await portalManager(db, withPm);
    expect(m).toEqual({ name: "Pam PM", employeeNo: "HFT-007" });
    expect(JSON.stringify(m)).not.toMatch(/0300|@m\.test/);
  });
  it("falls back to the project's manager, and shows nothing when nobody is assigned", async () => {
    expect(await portalManager(db, without)).toBeNull();
    expect(await portalManager(db, without, projManager)).toEqual({ name: "Mo Manager", employeeNo: null });
    expect((await portalProject(db, without, project))?.manager?.name).toBe("Mo Manager");
  });
  it("does not show a project to another client", async () => {
    expect(await portalProject(db, other, project)).toBeNull();
  });
});

describe("client statement CSV", () => {
  const doc = (rows: StatementDoc["rows"]): StatementDoc => ({ client: { name: "A" }, asOf: new Date(), company: {} as never, config: {} as never, rows, advances: [{ currency: "USD", amount: "50" }] });
  it("writes exact amounts, the currency column, advances, and neutralises spreadsheet formulas", () => {
    const csv = statementCsv(doc([
      { date: new Date("2026-11-01"), number: "INV-1", description: "=HYPERLINK(\"x\")", debit: "1200.50", credit: "0", balance: "1200.50", currency: "USD" },
      { date: new Date("2026-11-02"), number: "RCT-1", description: "Payment", debit: "0", credit: "200", balance: "1000.50", currency: "USD" },
    ]), "client");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Date,Document,Description,Charges,Payments,Balance,Currency");
    expect(lines[1]).toBe("2026-11-01,INV-1,\"'=HYPERLINK(\"\"x\"\")\",1200.50,,1200.50,USD");
    expect(lines[2]).toBe("2026-11-02,RCT-1,Payment,,200,1000.50,USD");
    expect(lines[3]).toBe(",,Credit held on account,,,50,USD");
  });
});
