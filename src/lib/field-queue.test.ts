// The phone's queue, without a browser: how one visit is sent and how each kind of answer is read.
import { describe, expect, it } from "vitest";
import { sendVisit, type QueuedVisit } from "./field-queue";

const visit = (over: Partial<QueuedVisit> = {}): QueuedVisit => ({ id: "ref-1", fields: { name: "Al Shifa", outcome: "CLOSED", phone: "", lat: "31.5" }, photos: [{ category: "PREMISES", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), name: "front.jpg" }], status: "QUEUED", createdAt: 1, attempts: 0, ...over });
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("sending a queued visit", () => {
  it("posts the fields, the clientRef and the photos as one form, and keeps the server's answer", async () => {
    let seen: FormData | null = null;
    const v = visit();
    const r = await sendVisit(v, (async (_url: unknown, init?: RequestInit) => { seen = init!.body as FormData; return new Response(JSON.stringify({ ok: true, prospectId: "p1", prospectName: "Al Shifa Pharmacy", created: true, revisit: false, needsDetails: true, outcome: "CLOSED", alsoProspectFor: [] }), { status: 200 }); }) as typeof fetch);
    expect(r.status).toBe("SENT");
    expect(seen!.get("clientRef")).toBe("ref-1");
    expect(seen!.get("name")).toBe("Al Shifa");
    expect(seen!.get("phone")).toBeNull(); // empty fields are not sent
    expect(seen!.getAll("photo").length).toBe(1);
    expect(seen!.get("photoCategory")).toBe("PREMISES");
    expect(v.result?.prospectName).toBe("Al Shifa Pharmacy");
  });
  it("a refusal (duplicate, bad number) is kept for the agent with the field it belongs to", async () => {
    const r = await sendVisit(visit(), reply(409, { error: "Al Shifa is already a prospect for Pharmivo", field: "phone" }) as unknown as typeof fetch);
    expect(r).toEqual({ status: "REFUSED", message: "Al Shifa is already a prospect for Pharmivo", field: "phone" });
  });
  it("no network, a server error or a rate limit means try again later; a lost sign-in is its own case", async () => {
    expect((await sendVisit(visit(), (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch)).status).toBe("RETRY");
    expect((await sendVisit(visit(), reply(502, {}) as unknown as typeof fetch)).status).toBe("RETRY");
    expect((await sendVisit(visit(), reply(429, {}) as unknown as typeof fetch)).status).toBe("RETRY");
    expect((await sendVisit(visit(), reply(401, { error: "Sign in again." }) as unknown as typeof fetch)).status).toBe("SIGNED_OUT");
    expect((await sendVisit(visit(), (async () => new Response("<html>bad gateway</html>", { status: 503 })) as typeof fetch)).status).toBe("RETRY");
  });
});
