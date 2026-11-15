// Picks an icon and a colour for a label, so tabs and stat cards get icons without per-page edits.
import type { IconName } from "@/components/shell/Icon";

export type Tone = "blue" | "violet" | "orange" | "green" | "pink" | "teal" | "amber" | "slate";

const GUESS: [RegExp, IconName, Tone][] = [
  [/overview|summary|home|dashboard/i, "home", "violet"],
  [/service|solution|catalog/i, "layers", "blue"],
  [/deliver|work|task/i, "truck", "teal"],
  [/bill|invoice|statement|ledger|payment|expense|finance|report|profit|balance|aging|tax/i, "receipt", "green"],
  [/project/i, "briefcase", "orange"],
  [/campaign|content|post/i, "sparkles", "pink"],
  [/portal|access|login|security|permission/i, "key", "slate"],
  [/contact|people|staff|team|user|member|client|vendor|partner/i, "users", "blue"],
  [/contract|agreement|template|document|file|asset|quote/i, "file", "amber"],
  [/calendar|schedule|meeting|visit|demo|attendance|leave/i, "calendar", "teal"],
  [/mail|email|message|chat|note|comment/i, "mail", "violet"],
  [/time|hour|history|activity|log|audit|timeline/i, "activity", "slate"],
  [/profile|personal|account|detail|about/i, "user", "blue"],
  [/setting|config|rule|policy/i, "settings", "slate"],
  [/lead|prospect|pipeline|deal|target/i, "target", "violet"],
];
export const guess = (label: string): [IconName, Tone] => {
  const g = GUESS.find(([re]) => re.test(label));
  return g ? [g[1], g[2]] : ["folder", "slate"];
};

