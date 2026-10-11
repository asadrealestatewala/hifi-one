// One search box across the records a person is allowed to open. Each group is only queried when the person holds the
// permission to view it, and uses the same record-level scope as the list screens (agents only find their own leads, project
// members only find their own projects). Results are links, never data from restricted areas such as payroll or bank details.
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;
export type Who = { id: string; organizationId: string; permissions: ReadonlySet<string> };
export type Hit = { label: string; sub?: string; href: string };
export type Group = { title: string; hits: Hit[] };

const LIMIT = 6;

export async function searchAll(db: Db, who: Who, raw: string): Promise<Group[]> {
  const q = raw.trim();
  if (q.length < 2 || q.length > 80) return [];
  const org = who.organizationId;
  const has = (p: string) => who.permissions.has(p);
  // Prisma passes "contains" through to LIKE unescaped, so wildcard characters are escaped here and typed text is taken literally
  const like = { contains: q.replace(/[\\%_]/g, (c) => "\\" + c), mode: "insensitive" as const };
  const groups: Promise<Group>[] = [];
  const add = (title: string, run: () => Promise<Hit[]>) => groups.push(run().then((hits) => ({ title, hits })));

  if (has("clients.view")) add("Clients", async () => (await db.client.findMany({ where: { organizationId: org, OR: [{ name: like }, { code: like }, { email: like }] }, take: LIMIT, orderBy: { name: "asc" } })).map((c) => ({ label: c.name, sub: [c.code, c.email].filter(Boolean).join(" · "), href: `/clients/${c.id}` })));
  if (has("crm.view")) {
    const scope = has("crm.view_all") ? {} : { OR: [{ assignedToId: who.id }, { createdById: who.id }] };
    add("Leads", async () => (await db.lead.findMany({ where: { organizationId: org, AND: [scope, { OR: [{ name: like }, { company: like }, { email: like }, { phone: like }] }] }, take: LIMIT, orderBy: { createdAt: "desc" } })).map((l) => ({ label: l.name, sub: l.company ?? undefined, href: `/leads/${l.id}` })));
  }
  if (has("finance.view")) add("Invoices", async () => (await db.invoice.findMany({ where: { organizationId: org, OR: [{ number: like }, { client: { name: like } }] }, take: LIMIT, orderBy: { createdAt: "desc" }, include: { client: { select: { name: true } } } })).map((i) => ({ label: i.number ?? "Draft invoice", sub: `${i.client.name} · ${i.status.toLowerCase().replace("_", " ")}`, href: `/finance/invoices/${i.id}` })));
  if (has("quotes.view")) add("Quotations", async () => (await db.quote.findMany({ where: { organizationId: org, OR: [{ number: like }, { client: { name: like } }] }, take: LIMIT, orderBy: { createdAt: "desc" }, include: { client: { select: { name: true } } } })).map((x) => ({ label: x.number, sub: `${x.client.name} · ${x.status.toLowerCase()}`, href: `/quotes/${x.id}` })));
  if (has("contracts.view")) add("Contracts", async () => (await db.contract.findMany({ where: { organizationId: org, OR: [{ title: like }, { client: { name: like } }] }, take: LIMIT, include: { client: { select: { name: true } } } })).map((c) => ({ label: c.title, sub: c.client.name, href: `/contracts/${c.id}` })));
  if (has("projects.view")) {
    const scope = has("projects.view_all") ? {} : { OR: [{ managerId: who.id }, { members: { some: { userId: who.id } } }] };
    add("Projects", async () => (await db.project.findMany({ where: { organizationId: org, AND: [scope, { OR: [{ name: like }, { number: like }] }] }, take: LIMIT, orderBy: { createdAt: "desc" } })).map((p) => ({ label: p.name, sub: `${p.number} · ${p.status.toLowerCase().replace("_", " ")}`, href: `/projects/${p.id}` })));
  }
  if (has("vendors.view")) add("Vendors", async () => (await db.vendor.findMany({ where: { organizationId: org, OR: [{ name: like }, { code: like }] }, take: LIMIT })).map((v) => ({ label: v.name, sub: v.code ?? undefined, href: `/vendors/${v.id}` })));
  if (has("users.view")) add("People", async () => (await db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", OR: [{ name: like }, { email: like }] }, take: LIMIT, orderBy: { name: "asc" } })).map((u) => ({ label: u.name, sub: u.email, href: `/users/${u.id}` })));

  return (await Promise.all(groups)).filter((g) => g.hits.length > 0);
}
