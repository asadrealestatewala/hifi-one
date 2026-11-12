import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { LiveViewError, endLiveView, endViewsFor, relayLiveSignal, requestLiveView, respondLiveView, liveKey } from "./live-view";
import { acknowledge, getPolicy, savePolicy, startBreak, startSession } from "./monitoring";
import { subscribe } from "./chat-hub";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, boss: string, ann: string, bob: string;
const noon = new Date("2026-10-12T07:00:00.000Z"); // 12:00 in Karachi, a Monday
const viewer = (id: string, perms: string[]) => ({ id, organizationId: org, name: "Boss", permissions: new Set(perms) });
const text = "x".repeat(80);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "LiveView","MonitoringAccess","WorkBreak","WorkSession","PolicyAck","MonitoringPolicy","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Live Org" } })).id;
  const u = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((x) => x.id);
  boss = await u("boss@l.test"); ann = await u("ann@l.test"); bob = await u("bob@l.test");
});
afterAll(async () => { await db.$disconnect(); });

describe("live screen view", () => {
  it("is refused without permission, when off, without consent, when not clocked in, on a break or outside hours", async () => {
    await expect(requestLiveView(db, viewer(boss, []), ann, noon)).rejects.toThrow(/permission/);
    const v = viewer(boss, ["monitoring.live_view"]);
    await savePolicy(db, { organizationId: org, actorId: boss, patch: { enabled: true, policyText: text } });
    await expect(requestLiveView(db, v, ann, noon)).rejects.toThrow(/not switched on/);
    await savePolicy(db, { organizationId: org, actorId: boss, patch: { liveView: true } });
    await expect(requestLiveView(db, v, ann, noon)).rejects.toThrow(/not accepted/);
    await acknowledge(db, { userId: ann, version: (await getPolicy(db, org)).version });
    await expect(requestLiveView(db, v, ann, noon)).rejects.toThrow(/not clocked in/);
    const s = await startSession(db, { organizationId: org, userId: ann, now: noon });
    await expect(requestLiveView(db, v, ann, new Date("2026-10-12T20:00:00.000Z"))).rejects.toThrow(/working hours/);
    await startBreak(db, { userId: ann, sessionId: s.id, now: noon });
    await expect(requestLiveView(db, v, ann, noon)).rejects.toThrow(/break/);
    await expect(requestLiveView(db, v, boss, noon)).rejects.toThrow(/yourself/);
    await db.workBreak.updateMany({ where: { sessionId: s.id }, data: { endedAt: noon } });
  });

  it("asks the person, logs nothing until they accept, and lets only the two people exchange the handshake", async () => {
    const v = viewer(boss, ["monitoring.live_view"]);
    const got: string[] = [];
    const off = subscribe(liveKey(ann), (e) => got.push(e));
    const lv = await requestLiveView(db, v, ann, noon);
    expect(got).toContain("request");
    await expect(requestLiveView(db, v, ann, noon)).rejects.toThrow(/already open/);
    expect(await db.monitoringAccess.count({ where: { subjectId: ann, what: "LIVE_VIEW" } })).toBe(0);
    await expect(respondLiveView(db, bob, lv.id, true, noon)).rejects.toThrow(LiveViewError); // not their request
    await expect(relayLiveSignal(db, ann, lv.id, { x: 1 })).rejects.toThrow(/not running/); // not accepted yet
    await respondLiveView(db, ann, lv.id, true, noon);
    expect(await db.monitoringAccess.count({ where: { subjectId: ann, viewerId: boss, what: "LIVE_VIEW", targetId: lv.id } })).toBe(1);
    await relayLiveSignal(db, boss, lv.id, { sdp: "x" });
    await expect(relayLiveSignal(db, bob, lv.id, { sdp: "x" })).rejects.toThrow(/not running/);
    await endLiveView(db, ann, lv.id, noon);
    expect((await db.liveView.findUniqueOrThrow({ where: { id: lv.id } })).status).toBe("ENDED");
    await expect(relayLiveSignal(db, boss, lv.id, { sdp: "x" })).rejects.toThrow(/not running/);
    off();
  });

  it("a decline logs nothing, an unanswered request expires, and clocking out ends a running view", async () => {
    const v = viewer(boss, ["monitoring.live_view"]);
    const a = await requestLiveView(db, v, ann, noon);
    await respondLiveView(db, ann, a.id, false, noon);
    expect((await db.liveView.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DECLINED");
    expect(await db.monitoringAccess.count({ where: { targetId: a.id } })).toBe(0);
    const b = await requestLiveView(db, v, ann, noon);
    await expect(respondLiveView(db, ann, b.id, true, new Date(noon.getTime() + 61_000))).rejects.toThrow(/no longer open/);
    expect((await db.liveView.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("EXPIRED");
    const c = await requestLiveView(db, v, ann, new Date(noon.getTime() + 120_000));
    await respondLiveView(db, ann, c.id, true, new Date(noon.getTime() + 121_000));
    await endViewsFor(db, ann);
    expect((await db.liveView.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ENDED");
  });
});

describe("remote support", () => {
  it("needs permission, a reason, the policy tick, and a person who is signed in and has accepted", async () => {
    await db.liveView.deleteMany({});
    const helper = viewer(boss, ["monitoring.remote_support"]);
    await expect(requestLiveView(db, viewer(boss, ["monitoring.live_view"]), ann, noon, { kind: "SUPPORT", reason: "printer broken" })).rejects.toThrow(/permission/);
    await expect(requestLiveView(db, helper, ann, noon, { kind: "SUPPORT", reason: "printer broken" })).rejects.toThrow(/not switched on/);
    await savePolicy(db, { organizationId: org, actorId: boss, patch: { remoteSupport: true } });
    await expect(requestLiveView(db, helper, ann, noon, { kind: "SUPPORT", reason: "hi" })).rejects.toThrow(/why/);
    await expect(requestLiveView(db, helper, ann, noon, { kind: "SUPPORT", reason: "printer broken" })).rejects.toThrow(/accepted/); // version bumped, ann must accept again
    await acknowledge(db, { userId: ann, version: (await getPolicy(db, org)).version });
    await expect(requestLiveView(db, helper, ann, noon, { kind: "SUPPORT", reason: "printer broken" })).rejects.toThrow(/not signed in/);
    const got: { event: string; data: unknown }[] = [];
    const off = subscribe(liveKey(ann), (event, data) => got.push({ event, data }));
    const lv = await requestLiveView(db, helper, ann, new Date("2026-10-12T20:00:00.000Z"), { kind: "SUPPORT", reason: "printer broken" }); // outside working hours is fine for support
    expect(got[0].data).toMatchObject({ kind: "SUPPORT", reason: "printer broken" });
    await respondLiveView(db, ann, lv.id, true, new Date("2026-10-12T20:00:10.000Z"));
    expect(await db.monitoringAccess.count({ where: { subjectId: ann, what: "REMOTE_SUPPORT", targetId: lv.id } })).toBe(1);
    await endViewsFor(db, ann); // clock-out does not cut a support session
    expect((await db.liveView.findUniqueOrThrow({ where: { id: lv.id } })).status).toBe("ACCEPTED");
    await endLiveView(db, boss, lv.id);
    off();
  });
});

import { markPhone, phoneSupportState, requestPhoneSupport } from "./live-view";
describe("remote support on company phones", () => {
  it("only company-owned phones, only with permission, reason, policy and consent; the phone sees the terms then the request", async () => {
    await db.liveView.deleteMany({});
    await db.pushDevice.deleteMany({});
    const helper = viewer(boss, ["monitoring.remote_support"]);
    const phone = await db.pushDevice.create({ data: { userId: ann, token: "ExponentPushToken[abcdefgh]" } });
    await expect(requestPhoneSupport(db, viewer(boss, []), phone.id, "screen frozen", noon)).rejects.toThrow(/permission/);
    await expect(requestPhoneSupport(db, helper, phone.id, "screen frozen", noon)).rejects.toThrow(/company-owned/);
    await expect(markPhone(db, { organizationId: "other-org", deviceId: phone.id, companyOwned: true })).rejects.toThrow(/not found/);
    await markPhone(db, { organizationId: org, deviceId: phone.id, companyOwned: true, label: "Sales phone 3" });
    await expect(requestPhoneSupport(db, helper, phone.id, "hi", noon)).rejects.toThrow(/why/);
    await savePolicy(db, { organizationId: org, actorId: boss, patch: { remoteSupport: false } });
    await expect(requestPhoneSupport(db, helper, phone.id, "screen frozen", noon)).rejects.toThrow(/not switched on/);
    await savePolicy(db, { organizationId: org, actorId: boss, patch: { remoteSupport: true } });
    expect((await phoneSupportState(db, { id: ann, organizationId: org }, noon)).needsTerms).toBe(true);
    await expect(requestPhoneSupport(db, helper, phone.id, "screen frozen", noon)).rejects.toThrow(/accepted/);
    await acknowledge(db, { userId: ann, version: (await getPolicy(db, org)).version });
    const lv = await requestPhoneSupport(db, helper, phone.id, "screen frozen", noon);
    const st = await phoneSupportState(db, { id: ann, organizationId: org }, noon);
    expect(st.request).toMatchObject({ id: lv.id, status: "REQUESTED", reason: "screen frozen" });
    expect((await phoneSupportState(db, { id: bob, organizationId: org }, noon)).request).toBeNull();
    await respondLiveView(db, ann, lv.id, false, noon);
    expect((await phoneSupportState(db, { id: ann, organizationId: org }, noon)).request).toBeNull();
    expect(await db.monitoringAccess.count({ where: { targetId: lv.id } })).toBe(0);
  });
});
