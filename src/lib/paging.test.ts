import { describe, expect, it } from "vitest";
import { PAGE_SIZE, pageRange, paging } from "./paging";

describe("paging", () => {
  it("defaults to the first page for missing or bad input", () => {
    for (const raw of [undefined, "", "0", "-3", "abc"]) expect(paging(raw)).toEqual({ page: 1, size: PAGE_SIZE, skip: 0, take: PAGE_SIZE });
  });
  it("skips earlier pages", () => {
    expect(paging("3", 20)).toEqual({ page: 3, size: 20, skip: 40, take: 20 });
  });
  it("caps absurd page numbers", () => {
    expect(paging("999999999").page).toBe(100_000);
  });
});

describe("pageRange", () => {
  it("describes the rows on a page", () => {
    expect(pageRange({ page: 2, size: 50 }, 230)).toEqual({ from: 51, to: 100, pages: 5 });
    expect(pageRange({ page: 5, size: 50 }, 230)).toEqual({ from: 201, to: 230, pages: 5 });
  });
  it("handles an empty list", () => {
    expect(pageRange({ page: 1, size: 50 }, 0)).toEqual({ from: 0, to: 0, pages: 1 });
  });
});
