import { describe, expect, it } from "vitest";
import { FileError, MAX_BYTES, safeName, validateUpload } from "./file-validation";

const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(50, 1)]);
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(20)]);
const jpg = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.alloc(20)]);

describe("validateUpload", () => {
  it("accepts real files and decides the content type itself", () => {
    expect(validateUpload("Receipt.PDF", pdf)).toEqual({ contentType: "application/pdf", filename: "Receipt.PDF" });
    expect(validateUpload("photo.jpeg", jpg).contentType).toBe("image/jpeg");
    expect(validateUpload("logo.png", png).contentType).toBe("image/png");
    expect(validateUpload("notes.txt", Buffer.from("hello, اردو text")).contentType).toBe("text/plain");
    expect(validateUpload("rows.csv", Buffer.from("a,b\n1,2\n")).contentType).toBe("text/csv");
  });
  it("refuses a file whose contents do not match its extension", () => {
    expect(() => validateUpload("invoice.pdf", png)).toThrow(/do not match/);
    expect(() => validateUpload("picture.png", pdf)).toThrow(/do not match/);
    expect(() => validateUpload("notes.txt", Buffer.from([1, 2, 3, 0, 4]))).toThrow(/do not match/);
  });
  it("refuses types that could run in a browser or on a computer", () => {
    for (const n of ["x.html", "x.svg", "x.js", "x.exe", "x.bat", "x.php", "x.sh", "x.dll", "x"]) expect(() => validateUpload(n, Buffer.from("<script>1</script>"))).toThrow(/not allowed/);
  });
  it("refuses programs disguised with a safe extension", () => {
    expect(() => validateUpload("report.pdf", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]))).toThrow(/Program files/);
    expect(() => validateUpload("report.txt", Buffer.from("#!/bin/sh\nrm -rf /"))).toThrow(/Program files/);
    expect(() => validateUpload("report.pdf", Buffer.concat([Buffer.from("7f454c46", "hex"), Buffer.alloc(100)]))).toThrow(/Program files/);
  });
  it("refuses office files that carry macros", () => {
    const zip = Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.from("word/vbaProject.bin"), Buffer.alloc(50)]);
    expect(() => validateUpload("memo.docx", zip)).toThrow(/macros/);
    expect(validateUpload("memo.docx", Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.alloc(50)])).contentType).toContain("wordprocessingml");
  });
  it("enforces size limits and rejects empty files", () => {
    expect(() => validateUpload("a.pdf", Buffer.alloc(0))).toThrow(/empty/);
    expect(() => validateUpload("a.pdf", Buffer.concat([pdf, Buffer.alloc(MAX_BYTES)]))).toThrow(/too large/);
  });
});

describe("safeName", () => {
  it("removes paths, control characters and header-breaking characters", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("C:\\Users\\x\\a.pdf")).toBe("a.pdf");
    expect(safeName('bad"name\r\n.pdf')).toBe("bad_name__.pdf");
    expect(safeName("...hidden")).toBe("hidden");
    expect(safeName("   ")).toBe("file");
    expect(safeName("x".repeat(300) + ".pdf").length).toBeLessThanOrEqual(120);
  });
  it("throws FileError type for bad input", () => {
    expect(() => validateUpload("x.exe", pdf)).toThrow(FileError);
  });
});
