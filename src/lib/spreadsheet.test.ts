import { describe, expect, it } from "vitest";
import { isExcelFile, xlsxToCsv } from "./spreadsheet";

describe("spreadsheet", () => {
  it("detects excel names", () => {
    expect(isExcelFile("List.XLSX")).toBe(true);
    expect(isExcelFile("a.xls")).toBe(true);
    expect(isExcelFile("a.csv")).toBe(false);
  });
  it("rejects non-xlsx bytes with a helpful message", async () => {
    await expect(xlsxToCsv(Buffer.from("not a zip"))).rejects.toThrow(/\.xlsx/);
  });
});
