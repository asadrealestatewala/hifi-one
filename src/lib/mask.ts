// Shows only the last 4 characters, e.g. "••••1234".
export function maskAccount(value: string | null | undefined): string {
  if (!value) return "";
  const v = value.replace(/\s/g, "");
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}
