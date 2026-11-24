// Company items in staff hands: what HR records, issues to people, takes back and writes off. It shares the register with the
// fixed assets in src/lib/assets.ts, so a laptop bought through Finance and a SIM recorded by HR sit in one list with one number
// series. Items HR records here are not in the books (inBooks = false): no journal, no depreciation, and a write-off is a record,
// not an accounting entry. Items in the books keep their purchase, depreciation and disposal in Finance; HR may still issue them,
// take them back and keep their condition up to date. Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { AssetError } from "./assets";
import { reviewRequest } from "./employee-requests";

export { AssetError };
type Tx = Prisma.TransactionClient;

export const ITEM_CATEGORIES = ["Laptop", "Desktop", "Monitor", "Phone", "SIM", "Tablet", "Accessory", "Furniture", "Access card or key", "Vehicle", "Other"] as const;
export const CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABEL: Record<string, string> = { NEW: "New", GOOD: "Good", FAIR: "Fair, some wear", DAMAGED: "Damaged", LOST: "Not returned (lost)" };
export const WRITE_OFF_REASONS = ["LOST", "STOLEN", "BROKEN", "GIVEN_AWAY", "OTHER"] as const;
export const WRITE_OFF_LABEL: Record<string, string> = { LOST: "Lost", STOLEN: "Stolen", BROKEN: "Broken beyond repair", GIVEN_AWAY: "Given away or sold", OTHER: "Other" };

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isCondition = (c: string): c is Condition => (CONDITIONS as readonly string[]).includes(c);
const text = (s: string | undefined, max: number, what: string) => {
  const t = (s ?? "").trim();
  if (t.length > max) throw new AssetError(`${what} can be at most ${max} characters.`);
  return t || null;
};
const today = () => new Date().toISOString().slice(0, 10);

async function nextNumber(tx: Tx, organizationId: string) {
  // The same counter as fixed assets, so a tag is never used twice across the register.
  const s = await tx.numberSequence.upsert({ where: { organizationId_key: { organizationId, key: "ASSET" } }, create: { organizationId, key: "ASSET", next: 2 }, update: { next: { increment: 1 } } });
  return `AST-${String(s.next - 1).padStart(4, "0")}`;
}

async function lockItem(tx: Tx, organizationId: string, assetId: string) {
  await tx.$queryRaw`SELECT id FROM "Asset" WHERE id = ${assetId} FOR UPDATE`;
  const a = await tx.asset.findFirst({ where: { id: assetId, organizationId } });
  if (!a) throw new AssetError("Item not found.");
  return a;
}

// HR records an item that is not bought through the books. Cost and purchase date are optional and for reference only.
export async function recordItem(
  db: PrismaClient,
  p: { organizationId: string; actorId: string; name: string; category: string; serialNumber?: string; condition?: string; location?: string; notes?: string; purchaseDate?: string; cost?: string; currency: string },
) {
  const name = p.name.trim();
  if (name.length < 2 || name.length > 120) throw new AssetError("Enter the item's name (2 to 120 characters).");
  if (!(ITEM_CATEGORIES as readonly string[]).includes(p.category)) throw new AssetError("Choose a category.");
  const condition = p.condition || "NEW";
  if (!isCondition(condition)) throw new AssetError("Choose the item's condition.");
  // Left empty when HR does not know it (an item outside the books has no purchase in the ledger)
  const purchaseDate = p.purchaseDate?.trim() ?? "";
  if (purchaseDate && !DATE.test(purchaseDate)) throw new AssetError("Enter a valid purchase date.");
  const cost = p.cost?.trim() || "0";
  if (!MONEY.test(cost)) throw new AssetError("Enter the cost as a number, or leave it empty.");
  const data = { serialNumber: text(p.serialNumber, 80, "The serial number"), location: text(p.location, 120, "The location"), notes: text(p.notes, 1000, "The notes") };
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, p.organizationId);
    return tx.asset.create({
      data: {
        organizationId: p.organizationId, number, name, category: p.category, ...data, condition, purchaseDate, cost, salvageValue: 0, currency: p.currency,
        usefulLifeMonths: 0, inBooks: false, createdById: p.actorId,
      },
    });
  });
}

// The physical details HR keeps current. Name and category of an item in the books belong to Finance's record.
export async function updateItem(
  db: PrismaClient,
  p: { organizationId: string; assetId: string; name?: string; category?: string; serialNumber?: string; condition: string; location?: string; notes?: string },
) {
  if (!isCondition(p.condition)) throw new AssetError("Choose the item's condition.");
  const data = { serialNumber: text(p.serialNumber, 80, "The serial number"), location: text(p.location, 120, "The location"), notes: text(p.notes, 1000, "The notes") };
  return db.$transaction(async (tx) => {
    const a = await lockItem(tx, p.organizationId, p.assetId);
    if (a.status !== "ACTIVE") throw new AssetError("This item has been written off or disposed of; its record is closed.");
    const own: { name?: string; category?: string } = {};
    if (!a.inBooks) {
      const name = (p.name ?? a.name).trim();
      if (name.length < 2 || name.length > 120) throw new AssetError("Enter the item's name (2 to 120 characters).");
      if (p.category && !(ITEM_CATEGORIES as readonly string[]).includes(p.category)) throw new AssetError("Choose a category.");
      own.name = name;
      if (p.category) own.category = p.category;
    }
    return tx.asset.update({ where: { id: a.id }, data: { ...own, ...data, condition: p.condition } });
  });
}

// Hands an item in stock to an employee. An item already with someone must be taken back first, so every handover has a return.
// When it answers an open equipment request from the same person, that request is approved in the same step.
export async function issueItem(
  db: PrismaClient,
  p: { organizationId: string; assetId: string; userId: string; actorId: string; condition?: string; requestId?: string },
) {
  return db.$transaction(async (tx) => {
    const a = await lockItem(tx, p.organizationId, p.assetId);
    if (a.status !== "ACTIVE") throw new AssetError("This item has been written off or disposed of.");
    if (a.assignedToId) throw new AssetError("This item is with someone already. Take it back first.");
    const person = await tx.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, include: { employeeProfile: { select: { status: true } } } });
    if (!person) throw new AssetError("Choose an active member of staff.");
    if (person.employeeProfile?.status === "EXITED") throw new AssetError("This person has left the company.");
    const condition = p.condition || a.condition;
    if (!isCondition(condition)) throw new AssetError("Choose the item's condition.");
    if (p.requestId) {
      const r = await tx.employeeRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId } });
      if (!r || r.type !== "EQUIPMENT") throw new AssetError("That equipment request was not found.");
      if (r.userId !== p.userId) throw new AssetError("The request is from someone else.");
      await reviewRequest(tx, { organizationId: p.organizationId, requestId: r.id, reviewerId: p.actorId, decision: "APPROVED", note: `Issued ${a.number}: ${a.name}. Please confirm you received it on My profile.` });
    }
    const assignment = await tx.assetAssignment.create({ data: { assetId: a.id, userId: p.userId, issuedById: p.actorId, conditionOut: condition, requestId: p.requestId || null } });
    const asset = await tx.asset.update({ where: { id: a.id }, data: { assignedToId: p.userId, condition } });
    return { asset, assignment };
  });
}

// Takes an item back into stock and records the condition it came back in. "LOST" closes the handover without the item coming back;
// HR then writes it off (items outside the books) or Finance disposes of it.
export async function returnItem(
  db: PrismaClient,
  p: { organizationId: string; assetId: string; actorId: string; condition: string; note?: string },
) {
  const lost = p.condition === "LOST";
  if (!lost && !isCondition(p.condition)) throw new AssetError("Choose the condition it came back in.");
  const note = text(p.note, 500, "The note");
  if (lost && !note) throw new AssetError("Say what happened to the item.");
  return db.$transaction(async (tx) => {
    const a = await lockItem(tx, p.organizationId, p.assetId);
    if (!a.assignedToId) throw new AssetError("This item is already in stock.");
    const open = await tx.assetAssignment.findFirst({ where: { assetId: a.id, returnedAt: null }, orderBy: { assignedAt: "desc" } });
    const from = a.assignedToId;
    if (open) await tx.assetAssignment.update({ where: { id: open.id }, data: { returnedAt: new Date(), returnedById: p.actorId, conditionIn: p.condition, returnNote: note } });
    const asset = await tx.asset.update({ where: { id: a.id }, data: { assignedToId: null, ...(lost ? {} : { condition: p.condition }) } });
    return { asset, fromUserId: from };
  });
}

// The employee confirms they received an item. Only their own, current handover, and only once.
export async function acknowledgeItem(db: PrismaClient, p: { organizationId: string; assignmentId: string; userId: string }) {
  const h = await db.assetAssignment.findFirst({ where: { id: p.assignmentId, userId: p.userId, asset: { organizationId: p.organizationId } } });
  if (!h || h.returnedAt) throw new AssetError("This item is not with you.");
  if (h.acknowledgedAt) return h;
  return db.assetAssignment.update({ where: { id: h.id }, data: { acknowledgedAt: new Date() } });
}

// Closes the record of an item outside the books that is gone for good. Items in the books are disposed of by Finance instead,
// because that posts the loss or gain. Any open handover is closed as not returned.
export async function writeOffItem(db: PrismaClient, p: { organizationId: string; assetId: string; actorId: string; reason: string; note?: string }) {
  if (!(WRITE_OFF_REASONS as readonly string[]).includes(p.reason)) throw new AssetError("Choose why the item is being written off.");
  const note = text(p.note, 500, "The note");
  if (p.reason === "OTHER" && !note) throw new AssetError("Say why the item is being written off.");
  return db.$transaction(async (tx) => {
    const a = await lockItem(tx, p.organizationId, p.assetId);
    if (a.inBooks) throw new AssetError("This item is in the books. Finance disposes of it under Fixed assets, which records the loss.");
    if (a.status !== "ACTIVE") return a; // idempotent
    await tx.assetAssignment.updateMany({ where: { assetId: a.id, returnedAt: null }, data: { returnedAt: new Date(), returnedById: p.actorId, conditionIn: "LOST", returnNote: note } });
    return tx.asset.update({
      where: { id: a.id },
      data: { status: "DISPOSED", disposedDate: today(), assignedToId: null, writeOffReason: note ? `${p.reason}: ${note}` : p.reason },
    });
  });
}

// What a person currently holds, with the open handover (for the exit check, their HR page and My profile).
export async function itemsHeldBy(db: PrismaClient, organizationId: string, userId: string) {
  const items = await db.asset.findMany({ where: { organizationId, assignedToId: userId, status: "ACTIVE" }, orderBy: { name: "asc" }, include: { assignments: { where: { returnedAt: null }, orderBy: { assignedAt: "desc" }, take: 1 } } });
  return items.map(({ assignments, ...a }) => ({ ...a, handover: assignments[0] ?? null }));
}
