import { describe, expect, it } from "vitest";
import { guess, recordTypeFromHref, recordTypeFromTitle, RECORD } from "./tint";

describe("record icons", () => {
  it("maps links to the record they open", () => {
    expect(recordTypeFromHref("/clients/abc")).toBe("client");
    expect(recordTypeFromHref("/leads/1")).toBe("lead");
    expect(recordTypeFromHref("/projects/p1")).toBe("project");
    expect(recordTypeFromHref("/projects/p1?task=t1")).toBe("task");
    expect(recordTypeFromHref("/finance/invoices/i1")).toBe("invoice");
    expect(recordTypeFromHref("/portal/invoices/i1")).toBe("invoice");
    expect(recordTypeFromHref("/vendors/v1")).toBe("vendor");
    expect(recordTypeFromHref("/me/leave")).toBe("staff");
    expect(recordTypeFromHref("/portal/projects/p1")).toBe("project");
    expect(recordTypeFromHref("/portal/meetings")).toBe("meeting");
    expect(recordTypeFromHref("/portal/content")).toBe("campaign");
  });
  it("returns null for pages that are not a record, and for no link", () => {
    expect(recordTypeFromHref("/settings")).toBeNull();
    expect(recordTypeFromHref(null)).toBeNull();
    expect(recordTypeFromHref("/clientsx")).toBeNull();
  });
  it("maps search group titles", () => {
    expect(recordTypeFromTitle("Clients")).toBe("client");
    expect(recordTypeFromTitle("People")).toBe("staff");
    expect(recordTypeFromTitle("Unknown")).toBeNull();
  });
  it("gives every record type an icon and an accent tone", () => {
    for (const r of Object.values(RECORD)) { expect(r.icon).toBeTruthy(); expect(r.tone).toBeTruthy(); }
  });
  it("guesses an icon for tab and stat labels, with a neutral fallback", () => {
    expect(guess("Billing")[0]).toBe("receipt");
    expect(guess("Zzz")).toEqual(["folder", "slate"]);
  });
});
