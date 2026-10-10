import { describe, expect, it } from "vitest";
import { LedgerError, allocateFifo, assertBalanced, computeInvoiceTotals, invoiceStatusAfterPayment, round2 } from "./ledger-math";

describe("invoice totals", () => {
  it("uses exact decimals, not floats", () => {
    // 0.1 + 0.2 style trap: three lines of 0.10 must total exactly 0.30
    const t = computeInvoiceTotals(
      [{ quantity: 1, unitPrice: "0.10" }, { quantity: 1, unitPrice: "0.10" }, { quantity: 1, unitPrice: "0.10" }],
      0,
    );
    expect(t.subtotal.toString()).toBe("0.3");
    expect(t.total.toString()).toBe("0.3");
  });
  it("rounds tax half up to 2 places", () => {
    const t = computeInvoiceTotals([{ quantity: 1, unitPrice: "100.05" }], 5);
    expect(t.taxAmount.toString()).toBe("5"); // 5.0025 -> 5.00
    expect(round2("2.675").toString()).toBe("2.68");
  });
  it("multiplies quantity by price per line", () => {
    const t = computeInvoiceTotals([{ quantity: "2.5", unitPrice: "799" }], 0);
    expect(t.total.toString()).toBe("1997.5");
  });
});

describe("assertBalanced", () => {
  const A = "a";
  const B = "b";
  it("accepts a balanced entry", () => {
    expect(() => assertBalanced([{ accountId: A, debit: "100.00" }, { accountId: B, credit: "100" }])).not.toThrow();
  });
  it("rejects unbalanced entries", () => {
    expect(() => assertBalanced([{ accountId: A, debit: "100" }, { accountId: B, credit: "99.99" }])).toThrow(LedgerError);
  });
  it("rejects negative, zero and two-sided lines", () => {
    expect(() => assertBalanced([{ accountId: A, debit: "-5" }, { accountId: B, credit: "-5" }])).toThrow();
    expect(() => assertBalanced([{ accountId: A, debit: "0" }, { accountId: B, credit: "0" }])).toThrow();
    expect(() => assertBalanced([{ accountId: A, debit: "5", credit: "5" }, { accountId: B, credit: "0.01" }])).toThrow();
  });
  it("rejects a single line", () => {
    expect(() => assertBalanced([{ accountId: A, debit: "5" }])).toThrow();
  });
});

describe("allocateFifo", () => {
  const open = [
    { id: "i1", outstanding: "100" },
    { id: "i2", outstanding: "50" },
  ];
  it("pays oldest first and leaves the rest as advance", () => {
    const r = allocateFifo("170", open);
    expect(r.allocations.map((a) => [a.invoiceId, a.amount.toString()])).toEqual([["i1", "100"], ["i2", "50"]]);
    expect(r.unallocated.toString()).toBe("20");
  });
  it("handles a partial payment", () => {
    const r = allocateFifo("120", open);
    expect(r.allocations.map((a) => [a.invoiceId, a.amount.toString()])).toEqual([["i1", "100"], ["i2", "20"]]);
    expect(r.unallocated.toString()).toBe("0");
  });
  it("never allocates more than the payment", () => {
    const r = allocateFifo("30", open);
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0].amount.toString()).toBe("30");
  });
});

describe("invoice status", () => {
  it("follows the amount paid", () => {
    expect(invoiceStatusAfterPayment("100", "0")).toBe("ISSUED");
    expect(invoiceStatusAfterPayment("100", "40")).toBe("PARTIALLY_PAID");
    expect(invoiceStatusAfterPayment("100", "100")).toBe("PAID");
  });
});
