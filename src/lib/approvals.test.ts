import { describe, expect, it } from "vitest";
import { summarise, waitingFor, type ApprovalGroup } from "./approvals";

const g = (key: string, count: number, since: string[]): ApprovalGroup => ({
  key, label: key, what: "", icon: "file", href: `/${key}`, count,
  rows: since.map((s, i) => ({ id: `${key}-${i}`, title: "x", since: new Date(s), href: `/${key}` })),
});

describe("summarise", () => {
  it("drops the kinds with nothing waiting", () => {
    const { groups, total } = summarise([g("leave", 2, ["2026-11-10T09:00:00Z", "2026-11-11T09:00:00Z"]), g("vouchers", 0, [])]);
    expect(groups.map((x) => x.key)).toEqual(["leave"]);
    expect(total).toBe(2);
  });

  it("puts the kind that has waited longest first", () => {
    const { groups, oldest } = summarise([
      g("vouchers", 1, ["2026-11-11T09:00:00Z"]),
      g("leave", 1, ["2026-11-09T09:00:00Z"]),
      g("visits", 1, ["2026-11-10T09:00:00Z"]),
    ]);
    expect(groups.map((x) => x.key)).toEqual(["leave", "visits", "vouchers"]);
    expect(oldest?.toISOString()).toBe("2026-11-09T09:00:00.000Z");
  });

  it("counts every row, not only the few shown", () => {
    const { total } = summarise([g("leave", 30, ["2026-11-10T09:00:00Z"])]);
    expect(total).toBe(30);
  });

  it("says nothing is waiting when nothing is", () => {
    expect(summarise([g("leave", 0, []), g("vouchers", 0, [])])).toEqual({ groups: [], total: 0, oldest: null });
  });
});

describe("waitingFor", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("counts whole days once there is one", () => {
    expect(waitingFor(new Date("2026-11-10T12:00:00Z"), now)).toBe("waiting 2 days");
    expect(waitingFor(new Date("2026-11-11T11:00:00Z"), now)).toBe("waiting 1 day");
  });
  it("falls back to hours inside a day", () => {
    expect(waitingFor(new Date("2026-11-12T09:00:00Z"), now)).toBe("waiting 3 hours");
    expect(waitingFor(new Date("2026-11-12T11:00:00Z"), now)).toBe("waiting 1 hour");
  });
  it("says just now for something that has only arrived", () => {
    expect(waitingFor(new Date("2026-11-12T11:40:00Z"), now)).toBe("just now");
  });
});
