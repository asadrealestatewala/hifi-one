// Proofing against hifi_one_test: the project manager attaches a design to a draft; the client comments on it (pins on an image, page
// numbers on a PDF) only while it waits for them and only on their own project; asking for changes can rest on the pins; the team
// ticks comments off; each version keeps its own proof and comments.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MemoryStorage } from "./storage";
import type { FileActor } from "./file-access";
import { createDeliverable, decide, editDeliverable, submitForApproval } from "./deliverables";
import { addProofComment, attachProof, proofBoard, resolveProofComment } from "./proofing";
import { openFile } from "./files";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(40, 1)]);
const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(40, 2)]);
const csv = Buffer.from("a,b\n1,2\n");
let org: string, client: string, otherClient: string, project: string;
let pm: FileActor, designer: FileActor, outsider: FileActor, portal: FileActor, otherPortal: FileActor;

const actor = (id: string, userType: string, perms: string[], clientId: string | null = null): FileActor => ({ id, organizationId: org, userType, clientId, vendorId: null, permissions: new Set(perms) });
const user = (name: string, userType = "EMPLOYEE", clientId: string | null = null) => db.user.create({ data: { organizationId: org, name, email: `${name}@proof.test`, passwordHash: "x", userType, clientId } }).then((u) => u.id);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "DeliverableComment","StoredFile","Notification","Deliverable","Task","ProjectMember","Project","User","Client","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Proof Org" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Food Co" } })).id;
  otherClient = (await db.client.create({ data: { organizationId: org, name: "Shoe Co" } })).id;
  pm = actor(await user("pm"), "EMPLOYEE", ["projects.view", "tasks.edit"]);
  designer = actor(await user("designer"), "EMPLOYEE", ["projects.view", "tasks.edit"]);
  outsider = actor(await user("outsider"), "EMPLOYEE", ["projects.view", "tasks.edit"]);
  portal = actor(await user("foodco", "CLIENT", client), "CLIENT", [], client);
  otherPortal = actor(await user("shoeco", "CLIENT", otherClient), "CLIENT", [], otherClient);
  project = (await db.project.create({ data: { organizationId: org, number: "PF-1", name: "Food social", clientId: client, managerId: pm.id, members: { create: [{ userId: pm.id }, { userId: designer.id }] } } })).id;
});
beforeEach(async () => { await db.deliverableComment.deleteMany(); await db.storedFile.deleteMany(); await db.deliverable.deleteMany(); await db.notification.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

const draft = () => createDeliverable(db, { organizationId: org, projectId: project, actorId: pm.id, title: "Eid post design" });

describe("proofing", () => {
  it("only the project manager attaches an image or PDF to a draft, and one proof per version is kept", async () => {
    const d = await draft();
    await expect(attachProof(db, storage, { actor: designer, deliverableId: d.id, name: "a.png", bytes: png })).rejects.toThrow(/cannot add files/);
    await expect(attachProof(db, storage, { actor: portal, deliverableId: d.id, name: "a.png", bytes: png })).rejects.toThrow();
    await expect(attachProof(db, storage, { actor: pm, deliverableId: d.id, name: "a.csv", bytes: csv })).rejects.toThrow(/image .* or a PDF/);
    await attachProof(db, storage, { actor: pm, deliverableId: d.id, name: "first.png", bytes: png });
    const second = await attachProof(db, storage, { actor: pm, deliverableId: d.id, name: "second.png", bytes: png });
    expect(await db.storedFile.count({ where: { ownerType: "DELIVERABLE", ownerId: d.id, deletedAt: null } })).toBe(1);
    expect((await proofBoard(db, pm, d.id))?.file).toMatchObject({ id: second.id, kind: "image" });
    // A proof alone is enough to send it for approval
    await submitForApproval(db, { organizationId: org, id: d.id, actorId: pm.id });
    await expect(attachProof(db, storage, { actor: pm, deliverableId: d.id, name: "late.png", bytes: png })).rejects.toThrow(/with the client/);
  });

  it("the client sees and comments only on their own project's version once it is sent, and pins stay on the image", async () => {
    const d = await draft();
    const f = await attachProof(db, storage, { actor: pm, deliverableId: d.id, name: "post.png", bytes: png });
    expect(await openFile(db, storage, portal, f.id)).toBeNull(); // still a draft
    await expect(addProofComment(db, { actor: portal, deliverableId: d.id, body: "Early look" })).rejects.toThrow(/Not found/);
    await submitForApproval(db, { organizationId: org, id: d.id, actorId: pm.id });
    expect(await openFile(db, storage, portal, f.id)).not.toBeNull();
    expect(await openFile(db, storage, otherPortal, f.id)).toBeNull();
    expect(await openFile(db, storage, outsider, f.id)).toBeNull(); // staff not on the project
    await expect(addProofComment(db, { actor: otherPortal, deliverableId: d.id, body: "Mine?" })).rejects.toThrow(/Not found/);

    await addProofComment(db, { actor: portal, deliverableId: d.id, body: "Make the logo bigger", x: 12.345, y: 80 });
    await addProofComment(db, { actor: portal, deliverableId: d.id, body: "Love the colours" });
    await expect(addProofComment(db, { actor: portal, deliverableId: d.id, body: "Off the edge", x: 120, y: 5 })).rejects.toThrow(/Place the pin/);
    await expect(addProofComment(db, { actor: portal, deliverableId: d.id, body: "Page?", page: 2 })).rejects.toThrow(/PDF/);
    await addProofComment(db, { actor: portal, deliverableId: d.id, body: "And the date", x: 50, y: 10 });
    const board = await proofBoard(db, portal, d.id);
    expect(board?.comments.map((c) => [c.body, c.pin, c.x, c.fromClient])).toEqual([["Make the logo bigger", 1, 12.35, true], ["Love the colours", null, null, true], ["And the date", 2, 50, true]]);
    expect(await db.notification.count({ where: { userId: pm.id, kind: "deliverable.comment" } })).toBe(1); // once a day per version
  });

  it("asking for changes can rest on the pins; the team ticks comments off; the new version starts clean", async () => {
    const d = await draft();
    await attachProof(db, storage, { actor: pm, deliverableId: d.id, name: "post.png", bytes: png });
    await submitForApproval(db, { organizationId: org, id: d.id, actorId: pm.id });
    await expect(decide(db, { organizationId: org, clientId: client, userId: portal.id, id: d.id, decision: "CHANGES" })).rejects.toThrow(/comments on the design/);
    const c = await addProofComment(db, { actor: portal, deliverableId: d.id, body: "Bigger logo", x: 10, y: 10 });
    const decided = await decide(db, { organizationId: org, clientId: client, userId: portal.id, id: d.id, decision: "CHANGES" });
    expect(decided).toMatchObject({ status: "CHANGES_REQUESTED", decisionNote: "See 1 comment on the design." });
    await expect(addProofComment(db, { actor: portal, deliverableId: d.id, body: "One more" })).rejects.toThrow(/waits for your approval/);

    await expect(resolveProofComment(db, { actor: portal, commentId: c.id, resolved: true })).rejects.toThrow();
    await expect(resolveProofComment(db, { actor: outsider, commentId: c.id, resolved: true })).rejects.toThrow(/Not found/);
    expect((await resolveProofComment(db, { actor: designer, commentId: c.id, resolved: true })).resolvedAt).not.toBeNull();

    await editDeliverable(db, { organizationId: org, id: d.id, title: "Eid post design" }); // version 2, a draft again
    await attachProof(db, storage, { actor: pm, deliverableId: d.id, name: "v2.pdf", bytes: pdf });
    expect(await proofBoard(db, pm, d.id)).toMatchObject({ version: 2, file: { kind: "pdf" }, comments: [], versions: [1, 2] });
    // While the team works on version 2 the deliverable is back with them, so the client has nothing to open
    expect(await proofBoard(db, portal, d.id)).toBeNull();
    await submitForApproval(db, { organizationId: org, id: d.id, actorId: pm.id });
    await addProofComment(db, { actor: portal, deliverableId: d.id, body: "Page 2 typo", page: 2 });
    expect((await proofBoard(db, portal, d.id))?.comments).toMatchObject([{ body: "Page 2 typo", page: 2, pin: null }]);
    expect((await proofBoard(db, portal, d.id, 1))?.comments).toHaveLength(1); // version 1's comment is still there
  });
});
