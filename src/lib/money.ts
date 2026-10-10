export const CURRENCIES = ["PKR", "USD", "AED", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

// Display only. Amounts are stored as exact decimals in the database.
export function formatMoney(amount: { toString(): string } | number | string, currency: string): string {
  const n = Number(amount.toString());
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}
