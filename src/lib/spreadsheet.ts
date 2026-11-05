import { readSheet } from "read-excel-file/node";

const csvField = (v: unknown): string => {
  let s: string;
  if (v == null) s = "";
  else if (v instanceof Date) s = v.toISOString().slice(0, 10);
  else s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function isExcelFile(name: string): boolean {
  return /\.xls[xm]?$/i.test(name);
}

/** Reads the first sheet of an .xlsx file and returns it as CSV text for the shared importer. */
export async function xlsxToCsv(data: Buffer): Promise<string> {
  // .xlsx is a zip archive; legacy .xls (and anything else) is not
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new Error("That file is not a valid .xlsx workbook. Old .xls files: open in Excel and save as .xlsx or CSV.");
  }
  let rows: unknown[][];
  try {
    rows = (await readSheet(data)) as unknown[][];
  } catch {
    throw new Error("Could not read that Excel file. Save it again as .xlsx or CSV and retry.");
  }
  return rows.map((r) => r.map(csvField).join(",")).join("\n");
}
