import { describe, expect, it } from "vitest";
import { orderFor, parseSort } from "./sort";

const allowed = ["name", "value"];
const fallback = { key: "name", dir: "asc" as const };
const cols = { name: { field: "name" }, value: { field: "dealValue", nullable: true } };

describe("parseSort", () => {
  it("accepts only named columns and falls back otherwise", () => {
    expect(parseSort("value", "desc", allowed, fallback)).toEqual({ key: "value", dir: "desc" });
    expect(parseSort("value", "sideways", allowed, fallback)).toEqual({ key: "value", dir: "asc" });
    expect(parseSort("passwordHash", "desc", allowed, fallback)).toEqual(fallback);
    expect(parseSort(undefined, "desc", allowed, fallback)).toEqual(fallback);
    expect(parseSort("__proto__", "asc", allowed, fallback)).toEqual(fallback);
  });
});

describe("orderFor", () => {
  it("adds an id tiebreak so paging is stable, and puts empty values last", () => {
    expect(orderFor({ key: "name", dir: "desc" }, cols)).toEqual([{ name: "desc" }, { id: "desc" }]);
    expect(orderFor({ key: "value", dir: "asc" }, cols)).toEqual([{ dealValue: { sort: "asc", nulls: "last" } }, { id: "asc" }]);
    expect(orderFor({ key: "unknown", dir: "asc" }, cols)).toEqual([{ id: "asc" }]);
  });
});
