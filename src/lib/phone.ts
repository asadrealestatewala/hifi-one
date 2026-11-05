// Phone numbers to E.164 (+<country code><number>) for any country. Pure. Pakistan is handled first because most searches start there:
// 0300 1234567, 300-1234567, 92 300 1234567, +92 (300) 1234567 and 0092... all become +923001234567.

// Calling codes for the countries the team is likely to search. A country not listed keeps the number Google gives (already international).
export const CALLING_CODES: Record<string, string> = {
  PK: "92", IN: "91", BD: "880", LK: "94", NP: "977", AF: "93", AE: "971", SA: "966", QA: "974", KW: "965", BH: "973", OM: "968", TR: "90", EG: "20",
  GB: "44", IE: "353", US: "1", CA: "1", AU: "61", NZ: "64", DE: "49", FR: "33", ES: "34", IT: "39", NL: "31", SE: "46", NO: "47", DK: "45", CH: "41",
  SG: "65", MY: "60", ID: "62", PH: "63", TH: "66", VN: "84", CN: "86", HK: "852", JP: "81", KR: "82", ZA: "27", NG: "234", KE: "254", BR: "55", MX: "52",
};

// Shortest and longest national number (without trunk 0) accepted per country; others use 6 to 12
const NATIONAL_LENGTH: Record<string, [number, number]> = { PK: [9, 10], IN: [10, 10], GB: [9, 10], US: [10, 10], CA: [10, 10], AE: [8, 9], SA: [8, 9] };

export function normalizeE164(raw: string | null | undefined, countryIso2: string | null | undefined): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  const hadPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;
  if (hadPlus) return s.length >= 7 && s.length <= 15 ? `+${s}` : null;
  if (s.startsWith("00")) { s = s.slice(2); return s.length >= 7 && s.length <= 15 ? `+${s}` : null; }
  const iso = (countryIso2 ?? "").toUpperCase();
  const cc = CALLING_CODES[iso];
  if (!cc) return null; // no country to anchor a local number to: better empty than wrong
  const [min, max] = NATIONAL_LENGTH[iso] ?? [6, 12];
  // Already carries the country code
  if (s.startsWith(cc) && s.length - cc.length >= min && s.length - cc.length <= max + 1) {
    const rest = s.slice(cc.length).replace(/^0+/, "");
    if (rest.length >= min && rest.length <= max) return `+${cc}${rest}`;
  }
  const national = s.replace(/^0+/, "");
  return national.length >= min && national.length <= max ? `+${cc}${national}` : null;
}

// The last 9 digits: how the same person's number is recognised whether it was typed locally (0300…) or internationally (+92300…)
export function phoneTail(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}

// ISO country list from the runtime's own region names, so any country can be searched
export function countryOptions(): { code: string; name: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    let name: string | undefined;
    try { name = names.of(code); } catch { name = undefined; }
    if (name && name !== code && !/unknown region/i.test(name)) out.push({ code, name });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
export const isCountry = (code: string) => /^[A-Z]{2}$/.test(code) && countryOptions().some((c) => c.code === code);
export const countryName = (code: string) => countryOptions().find((c) => c.code === code)?.name ?? code;

// Countries a number can be anchored to with the country picker (the ones with a calling code above), with the code in the label.
export function callingCodeOptions(): { code: string; name: string; dial: string; label: string }[] {
  return countryOptions().filter((c) => c.code in CALLING_CODES).map((c) => ({ ...c, dial: `+${CALLING_CODES[c.code]}`, label: `${c.name} (+${CALLING_CODES[c.code]})` }));
}

const LOCAL_EXAMPLE: Record<string, string> = { PK: "0300 1234567", IN: "98765 43210", GB: "07700 900123", US: "(555) 123-4567", AE: "050 123 4567", SA: "050 123 4567" };

// Why a number was not accepted, in words a salesperson can act on. Null when normalizeE164 accepts it.
export function phoneProblem(raw: string | null | undefined, countryIso2: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (normalizeE164(text, countryIso2)) return null;
  if (/[a-z]/i.test(text)) return "Use digits only. Spaces, dashes and a leading + are fine.";
  const iso = (countryIso2 ?? "").toUpperCase();
  const cc = CALLING_CODES[iso];
  const digits = text.replace(/\D/g, "");
  if (!digits) return "Enter the phone number using digits.";
  if (text.startsWith("+") || digits.startsWith("00")) return "That international number is too short or too long. Check every digit, with the country code first.";
  if (!cc) return "Choose the country code first, or start the number with + and the country code.";
  const [min, max] = NATIONAL_LENGTH[iso] ?? [6, 12];
  const national = digits.replace(/^0+/, "");
  const country = countryOptions().find((c) => c.code === iso)?.name ?? iso;
  const example = LOCAL_EXAMPLE[iso] ? ` For example ${LOCAL_EXAMPLE[iso]}.` : "";
  return national.length < min
    ? `That looks too short for ${country}: it needs ${min === max ? min : `${min} to ${max}`} digits after the leading 0, you entered ${national.length}.${example}`
    : `That looks too long for ${country}: it needs ${min === max ? min : `${min} to ${max}`} digits after the leading 0, you entered ${national.length}. If it is a number from another country, start it with + and its country code.`;
}
