import { describe, expect, it } from "vitest";
import { listHref, parseListParams } from "./list-params";
import { pageRange, paging } from "./paging";
import { csvCell } from "./crm-contacts";

describe("list address parsing", () => {
  const opts = { sorts: ["name", "created"], statuses: ["OPEN", "PAID"], ids: ["stage"] };

  it("reads search, sort, status, dates, ids and page from a Next.js searchParams object or URLSearchParams", () => {
    const a = parseListParams({ q: "  acme ", sort: "name", dir: "desc", status: "PAID", page: "3", from: "2026-01-01", to: "2026-01-31", stage: "ck123" }, opts);
    expect(a).toMatchObject({ q: "acme", sort: { key: "name", dir: "desc" }, sortChosen: true, status: "PAID", range: { from: "2026-01-01", to: "2026-01-31" }, ids: { stage: "ck123" } });
    expect(a.page).toEqual({ page: 3, size: 50, skip: 100, take: 50 });
    const b = parseListParams(new URLSearchParams("q=acme&status=PAID"), opts);
    expect(b.q).toBe("acme");
    expect(b.status).toBe("PAID");
  });

  it("falls back to defaults for anything it does not recognise", () => {
    const p = parseListParams({ q: "   ", sort: "passwordHash", dir: "sideways", status: "HACKED", page: "-4", from: "2026-02-30x", stage: "a b;drop" }, opts);
    expect(p.q).toBeUndefined();
    expect(p.sort).toEqual({ key: "created", dir: "desc" });
    expect(p.sortChosen).toBe(false);
    expect(p.status).toBeUndefined();
    expect(p.page.page).toBe(1);
    expect(p.range).toEqual({ from: undefined, to: undefined });
    expect(p.ids.stage).toBeUndefined();
    expect(parseListParams({ q: "x".repeat(101) }).q).toBeUndefined();
    expect(parseListParams({ page: "abc" }).page.skip).toBe(0);
    expect(parseListParams({ page: "999999999" }).page.page).toBe(100_000);
  });

  it("rejects a reversed date range rather than guessing", () => {
    expect(parseListParams({ from: "2026-02-01", to: "2026-01-01" }).range).toEqual({});
  });

  it("builds links that keep other filters and drop empty ones", () => {
    expect(listHref("/leads", { q: "acme", stage: undefined, sort: "name" }, { page: "2" })).toBe("/leads?q=acme&sort=name&page=2");
    expect(listHref("/leads", { q: "acme" }, { q: undefined })).toBe("/leads");
  });
});

describe("pagination maths", () => {
  it("shows x–y of N and the number of pages", () => {
    expect(pageRange(paging("1"), 0)).toEqual({ from: 0, to: 0, pages: 1 });
    expect(pageRange(paging("1"), 120)).toEqual({ from: 1, to: 50, pages: 3 });
    expect(pageRange(paging("3"), 120)).toEqual({ from: 101, to: 120, pages: 3 });
    expect(pageRange(paging("2"), 100)).toEqual({ from: 51, to: 100, pages: 2 });
  });
});

describe("CSV cells", () => {
  it("defuses formulas but keeps plain (also negative) numbers summable", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("-150.00")).toBe("-150.00");
    expect(csvCell("1200.50")).toBe("1200.50");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell(null)).toBe("");
  });
});
