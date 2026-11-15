import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ClientDetailsError, updateClientDetails } from "./client-details";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, client: string, otherClient: string;
const base = { name: "HB Elan", email: "", phone: "+923336177901", country: "Pakistan", taxId: "", billingAddress: "", paymentTermsDays: "0" };

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Client","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Details Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "HB Elan", currency: "PKR", phone: "+923336177901", country: "Pakistan" } })).id;
  await db.client.create({ data: { organizationId: org, name: "Ace Real Estate", currency: "USD" } });
  otherClient = (await db.client.create({ data: { organizationId: other, name: "Elsewhere", currency: "PKR" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("editing client details", () => {
  it("changes payment terms and contact details, and reports only what changed", async () => {
    const r = await updateClientDetails(db, { organizationId: org, clientId: client, input: { ...base, email: "Babar@HBElan.pk", taxId: "NTN-123" } });
    expect(r.changed).toBe(true);
    expect(r.before).toEqual({ email: null, taxId: null, paymentTermsDays: 14 });
    expect(r.after).toEqual({ email: "babar@hbelan.pk", taxId: "NTN-123", paymentTermsDays: 0 });
    const c = await db.client.findUniqueOrThrow({ where: { id: client } });
    expect([c.paymentTermsDays, c.email, c.currency]).toEqual([0, "babar@hbelan.pk", "PKR"]);
  });
  it("writes nothing when nothing changed", async () => {
    const r = await updateClientDetails(db, { organizationId: org, clientId: client, input: { ...base, email: "babar@hbelan.pk", taxId: "NTN-123" } });
    expect(r.changed).toBe(false);
  });
  it("never changes the billing currency, even if the form sends one", async () => {
    await updateClientDetails(db, { organizationId: org, clientId: client, input: { ...base, currency: "USD" } });
    expect((await db.client.findUniqueOrThrow({ where: { id: client } })).currency).toBe("PKR");
  });
  it("refuses bad input", async () => {
    await expect(updateClientDetails(db, { organizationId: org, clientId: client, input: { ...base, paymentTermsDays: "-1" } })).rejects.toThrow(ClientDetailsError);
    await expect(updateClientDetails(db, { organizationId: org, clientId: client, input: { ...base, paymentTermsDays: "400" } })).rejects.toThrow(ClientDetailsError);
    await expect(updateClientDetails(db, { organizationId: org, clientId: client, input: { ...base, email: "not-an-email" } })).rejects.toThrow("valid email");
    await expect(updateClientDetails(db, { organizationId: org, clientId: client, input: { ...base, name: "x" } })).rejects.toThrow("name");
  });
  it("refuses a name another client already has", async () => {
    await expect(updateClientDetails(db, { organizationId: org, clientId: client, input: { ...base, name: "ace real estate" } })).rejects.toThrow("already has this name");
  });
  it("cannot touch a client of another organisation", async () => {
    await expect(updateClientDetails(db, { organizationId: org, clientId: otherClient, input: base })).rejects.toThrow("not found");
    expect((await db.client.findUniqueOrThrow({ where: { id: otherClient } })).paymentTermsDays).toBe(14);
  });
});
