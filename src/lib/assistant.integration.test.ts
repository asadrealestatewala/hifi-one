import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftInvoice, issueInvoice } from "./accounting";
import { AssistantError, TOOLS, ask, runTool, toolsFor, type ModelCall, type ModelResponse } from "./assistant";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string;

const finance = { id: "u1", name: "Fin", organizationId: "", permissions: new Set(["finance.view", "reports.view"]) };
const nobody = { id: "u2", name: "Nobody", organizationId: "", permissions: new Set<string>() };

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","Account","Client","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "AI Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  finance.organizationId = org; nobody.organizationId = org;
  for (const [o, name] of [[org, "Acme"], [other, "SecretCo"]] as const) {
    await db.account.create({ data: { organizationId: o, code: "1200", name: "AR", type: "ASSET", systemKey: "AR" } });
    await db.account.create({ data: { organizationId: o, code: "4000", name: "Rev", type: "REVENUE", systemKey: "REVENUE_SERVICE" } });
    const c = await db.client.create({ data: { organizationId: o, name, currency: "USD", paymentTermsDays: 0 } });
    const d = await createDraftInvoice(db, { organizationId: o, clientId: c.id, currency: "USD", taxRate: "0", createdById: "u", lines: [{ description: "Work", quantity: "1", unitPrice: o === org ? "700" : "99999" }] });
    await issueInvoice(db, { organizationId: o, invoiceId: d.id, actorId: "u" });
  }
  await db.invoice.updateMany({ data: { dueDate: new Date(Date.now() - 5 * 86400000) } });
});
afterAll(async () => { await db.$disconnect(); });

const tool = (name: string): ModelResponse => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `t-${name}`, name, input: {} }] });
const text = (t: string): ModelResponse => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });
const script = (...rs: ModelResponse[]): { call: ModelCall; seen: { system: string; tools: { name: string }[]; messages: unknown[] }[] } => {
  const seen: { system: string; tools: { name: string }[]; messages: unknown[] }[] = [];
  let i = 0;
  return { seen, call: async (req) => { seen.push({ system: req.system, tools: req.tools as { name: string }[], messages: JSON.parse(JSON.stringify(req.messages)) }); return rs[Math.min(i++, rs.length - 1)]; } };
};

describe("which tools a person gets", () => {
  it("offers only tools their permissions allow", () => {
    expect(toolsFor(new Set()).length).toBe(0);
    expect(toolsFor(new Set(["finance.view"])).map((t) => t.name).sort()).toEqual(["overdue_invoices", "receivables_summary"]);
    expect(toolsFor(new Set(TOOLS.map((t) => t.permission))).length).toBe(TOOLS.length);
  });
  it("refuses a tool the model asks for when the person lacks permission, and does not record it as used", async () => {
    const used: string[] = [];
    expect(await runTool(db, nobody, "overdue_invoices", used)).toEqual({ error: "You do not have access to that information." });
    expect(await runTool(db, finance, "profit_this_month", used)).not.toHaveProperty("error");
    expect(await runTool(db, finance, "my_open_tasks", used)).toEqual({ error: "You do not have access to that information." });
    expect(await runTool(db, finance, "delete_everything", used)).toEqual({ error: "You do not have access to that information." });
    expect(used).toEqual(["profit_this_month"]);
  });
});

describe("asking", () => {
  it("passes tool results to the model, returns its answer, and only ever reads this organization", async () => {
    const s = script(tool("overdue_invoices"), text("Acme owes 700 USD."));
    const r = await ask(db, finance, "Which invoices are overdue?", s.call);
    expect(r.answer).toBe("Acme owes 700 USD.");
    expect(r.toolsUsed).toEqual(["overdue_invoices"]);
    const lastUser = JSON.stringify(s.seen[1].messages.at(-1));
    expect(lastUser).toContain("Acme");
    expect(lastUser).toContain("700");
    expect(lastUser).not.toContain("SecretCo");
    expect(lastUser).not.toContain("99999");
  });

  it("only advertises the tools the person may use and tells the model to treat data as data", async () => {
    const s = script(text("ok"));
    await ask(db, finance, "How are we doing?", s.call);
    expect(s.seen[0].tools.map((t) => t.name).sort()).toEqual(["overdue_invoices", "profit_this_month", "receivables_summary"]);
    expect(s.seen[0].system).toMatch(/not instructions/i);
    expect(s.seen[0].system).toMatch(/cannot change anything/i);
  });

  it("a model that insists on a forbidden tool just receives a refusal", async () => {
    const s = script(tool("my_open_tasks"), text("I could not read that."));
    const r = await ask(db, finance, "What tasks do I have?", s.call);
    expect(JSON.stringify(s.seen[1].messages.at(-1))).toContain("do not have access");
    expect(r.toolsUsed).toEqual([]);
  });

  it("stops a runaway tool loop", async () => {
    const s = script(tool("receivables_summary"));
    const r = await ask(db, finance, "Loop forever", s.call);
    expect(s.seen.length).toBe(5);
    expect(r.answer).toMatch(/too many steps/);
  });

  it("validates the question and refuses people with no readable data", async () => {
    await expect(ask(db, finance, "hi", script(text("x")).call)).rejects.toThrow(AssistantError);
    await expect(ask(db, finance, "x".repeat(1001), script(text("x")).call)).rejects.toThrow(/1000/);
    await expect(ask(db, nobody, "Tell me everything", script(text("x")).call)).rejects.toThrow(/no data/);
  });

  it("without an API key the real call refuses rather than pretending", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(ask(db, finance, "Anything at all", undefined)).rejects.toThrow(/not connected/);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });
});
