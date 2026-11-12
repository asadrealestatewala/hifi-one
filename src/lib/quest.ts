// Pure rules for the sales quest card (daily goals, XP, levels, streak). No database, so every rule is unit-tested.
// Days are calendar days in the organisation's time zone (default Pakistan), never UTC.

export type QuestConfig = {
  tz: string;
  goalContacts: number; // contacts with a phone number added per day
  goalActivities: number; // activities logged per day
  goalVisits: number; // field visits per day; 0 = the field-visit goal is hidden
  xpContact: number;
  xpActivity: number; // also paid for a field visit
  xpVerifiedCall: number; // outside the daily cap: a manager checked it
  xpConversion: number; // outside the daily cap
  dailyXpCap: number; // most XP that contacts + activities + visits can earn in one day
  levelBase: number; // XP for level n = levelBase * (n-1)^2
  minNoteLength: number; // a plain note shorter than this earns no XP
  weekendDays: number[]; // 0 = Sunday ... 6 = Saturday; skipped by the streak
};

export const DEFAULT_QUEST: QuestConfig = {
  tz: "Asia/Karachi", goalContacts: 5, goalActivities: 10, goalVisits: 0,
  xpContact: 10, xpActivity: 5, xpVerifiedCall: 15, xpConversion: 100,
  dailyXpCap: 150, levelBase: 600, minNoteLength: 15, weekendDays: [0, 6], // overridden by the working calendar at read time (see questFor)
};
export const LEVELS = ["Rookie", "Prospector", "Closer", "Rainmaker", "Legend"];

export type QuestSettingsData = { base: Partial<QuestConfig>; roles: Record<string, Partial<QuestConfig>>; holidays: string[] };
export const EMPTY_SETTINGS: QuestSettingsData = { base: {}, roles: {}, holidays: [] };

const INT_LIMITS: Record<Exclude<keyof QuestConfig, "tz" | "weekendDays">, [number, number]> = {
  goalContacts: [0, 200], goalActivities: [0, 500], goalVisits: [0, 200], xpContact: [0, 1000], xpActivity: [0, 1000],
  xpVerifiedCall: [0, 1000], xpConversion: [0, 10000], dailyXpCap: [1, 100000], levelBase: [10, 100000], minNoteLength: [0, 500],
};

export const isDateKey = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

// Keeps only valid fields, so a damaged settings row can never break the card.
export function cleanConfig(raw: unknown): Partial<QuestConfig> {
  const out: Partial<QuestConfig> = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(INT_LIMITS) as (keyof typeof INT_LIMITS)[]) {
    const v = r[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= INT_LIMITS[k][0] && v <= INT_LIMITS[k][1]) out[k] = v;
  }
  if (typeof r.tz === "string") { try { new Intl.DateTimeFormat("en", { timeZone: r.tz }); out.tz = r.tz; } catch { /* ignore */ } }
  if (Array.isArray(r.weekendDays) && r.weekendDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) out.weekendDays = [...new Set(r.weekendDays as number[])];
  return out;
}

export function parseSettings(raw: unknown): QuestSettingsData {
  if (!raw || typeof raw !== "object") return EMPTY_SETTINGS;
  const r = raw as { base?: unknown; roles?: unknown; holidays?: unknown };
  const roles: Record<string, Partial<QuestConfig>> = {};
  if (r.roles && typeof r.roles === "object") for (const [k, v] of Object.entries(r.roles)) roles[k] = cleanConfig(v);
  return { base: cleanConfig(r.base), roles, holidays: Array.isArray(r.holidays) ? r.holidays.filter((d): d is string => typeof d === "string" && isDateKey(d)).sort() : [] };
}

// A role's override wins over the organisation default. A person with several roles uses the first one (by role key) that has an override.
export function resolveConfig(s: QuestSettingsData, roleKeys: string[]): QuestConfig {
  const hit = [...roleKeys].sort().find((k) => s.roles[k] && Object.keys(s.roles[k]).length > 0);
  return { ...DEFAULT_QUEST, ...s.base, ...(hit ? s.roles[hit] : {}) };
}

// ---------- days in the organisation's time zone ----------
export function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const tzOffsetMs = (at: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000;
};
// The instant a calendar day starts in that time zone.
export function dayStartInstant(key: string, tz: string): Date {
  const guess = new Date(`${key}T00:00:00Z`);
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}
export const addDays = (key: string, n: number) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const isOffDay = (key: string, cfg: Pick<QuestConfig, "weekendDays">, holidays: string[]) =>
  cfg.weekendDays.includes(new Date(`${key}T00:00:00Z`).getUTCDay()) || holidays.includes(key);

// ---------- what counts ----------
export type Counted = { at: Date };
export type Act = { at: Date; kind: string; body: string | null };
// A plain note only counts when it says something; calls, emails, meetings and WhatsApp always count.
export const actCounts = (a: Act, cfg: Pick<QuestConfig, "minNoteLength">) => a.kind !== "SYSTEM" && (a.kind !== "NOTE" || (a.body ?? "").trim().length >= cfg.minNoteLength);

export type DayTally = { contacts: number; activities: number; visits: number };
export function tallyByDay(cfg: QuestConfig, contacts: Date[], acts: Act[], visits: Date[]): Map<string, DayTally> {
  const m = new Map<string, DayTally>();
  const bump = (d: Date, f: keyof DayTally) => { const k = dayKey(d, cfg.tz); const t = m.get(k) ?? { contacts: 0, activities: 0, visits: 0 }; t[f]++; m.set(k, t); };
  contacts.forEach((d) => bump(d, "contacts"));
  acts.filter((a) => actCounts(a, cfg)).forEach((a) => bump(a.at, "activities"));
  visits.forEach((d) => bump(d, "visits"));
  return m;
}

export const dayXp = (cfg: QuestConfig, t: DayTally) => Math.min(cfg.dailyXpCap, t.contacts * cfg.xpContact + (t.activities + t.visits) * cfg.xpActivity);
export function totalXp(cfg: QuestConfig, days: Map<string, DayTally>, verifiedCalls: number, conversions: number): number {
  let xp = verifiedCalls * cfg.xpVerifiedCall + conversions * cfg.xpConversion;
  for (const t of days.values()) xp += dayXp(cfg, t);
  return xp;
}

export const levelStart = (cfg: Pick<QuestConfig, "levelBase">, level: number) => Math.round((level - 1) ** 2 * cfg.levelBase);
export function levelFor(cfg: Pick<QuestConfig, "levelBase">, xp: number) {
  const level = Math.min(LEVELS.length, Math.floor(Math.sqrt(xp / cfg.levelBase)) + 1);
  return { level, levelName: LEVELS[level - 1], levelStartsAt: levelStart(cfg, level), nextLevelAt: level >= LEVELS.length ? null : levelStart(cfg, level + 1) };
}

// Consecutive working days with some work, counted back from today. A weekend or holiday never breaks it, and neither does today
// when nothing is logged yet. A day worked on a weekend or holiday still counts.
export function streakFor(cfg: QuestConfig, holidays: string[], days: Map<string, DayTally>, today: string): number {
  const worked = (k: string) => { const t = days.get(k); return !!t && t.contacts + t.activities + t.visits > 0; };
  let streak = 0;
  for (let i = 0; i < 120; i++) {
    const k = addDays(today, -i);
    if (worked(k)) streak++;
    else if (i === 0 || isOffDay(k, cfg, holidays)) continue;
    else break;
  }
  return streak;
}

// ---------- settings form ----------
export const FIELD_LABELS: Record<Exclude<keyof QuestConfig, "tz" | "weekendDays">, string> = {
  goalContacts: "Contacts per day (with a phone number)", goalActivities: "Activities per day", goalVisits: "Field visits per day (0 = hide)",
  xpContact: "XP per contact", xpActivity: "XP per activity or visit", xpVerifiedCall: "XP per verified call", xpConversion: "XP per conversion",
  dailyXpCap: "Daily XP cap (contacts, activities, visits)", levelBase: "Level pace: XP for level 2 (level n needs this × (n-1)²)", minNoteLength: "Shortest note that earns XP (characters)",
};
export const FIELD_KEYS = Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[];

// A blank box means "use the default". Throws a plain message the person can act on.
export function readFields(get: (k: string) => string, keys: readonly (keyof typeof FIELD_LABELS)[] = FIELD_KEYS): Partial<QuestConfig> {
  const out: Partial<QuestConfig> = {};
  for (const k of keys) {
    const raw = get(k).trim();
    if (raw === "") continue;
    const n = Number(raw);
    const [lo, hi] = INT_LIMITS[k];
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${FIELD_LABELS[k]} must be a whole number from ${lo} to ${hi}.`);
    out[k] = n;
  }
  return out;
}
export function readHolidays(text: string): string[] {
  const list = text.split(/[\s,;]+/).filter(Boolean);
  for (const d of list) if (!isDateKey(d)) throw new Error(`"${d}" is not a date. Write holidays as YYYY-MM-DD, one per line.`);
  return [...new Set(list)].sort();
}
