// Picks an icon and a colour for a label, so tabs and stat cards get icons without per-page edits.
import type { IconName } from "@/components/shell/Icon";

export type Tone = "blue" | "violet" | "orange" | "green" | "pink" | "teal" | "amber" | "slate";

const GUESS: [RegExp, IconName, Tone][] = [
  [/overdue|late|due|pending|waiting|expir/i, "clock", "amber"],
  [/draft/i, "edit", "slate"],
  [/outstanding|owed|receivable|revenue|income|paid|collected|amount|value|mrr|arr/i, "wallet", "green"],
  [/inactive|archived|ended|cancel|lost/i, "close", "slate"],
  [/active|open|live|current/i, "activity", "teal"],
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


// One icon and colour per record type, used wherever that record appears (search, notifications, palette, headers),
// so people learn to recognise a client, an invoice or a task at a glance.
export type RecordType = "client" | "lead" | "project" | "task" | "invoice" | "quote" | "contract" | "vendor" | "staff" | "payment" | "meeting" | "campaign";
export const RECORD: Record<RecordType, { icon: IconName; tone: Tone; label: string }> = {
  client: { icon: "building", tone: "blue", label: "Client" },
  lead: { icon: "target", tone: "violet", label: "Lead" },
  project: { icon: "briefcase", tone: "orange", label: "Project" },
  task: { icon: "check", tone: "teal", label: "Task" },
  invoice: { icon: "receipt", tone: "green", label: "Invoice" },
  quote: { icon: "file", tone: "slate", label: "Quotation" },
  contract: { icon: "file", tone: "amber", label: "Contract" },
  vendor: { icon: "truck", tone: "amber", label: "Vendor" },
  staff: { icon: "user", tone: "pink", label: "Staff" },
  payment: { icon: "wallet", tone: "green", label: "Payment" },
  meeting: { icon: "video", tone: "teal", label: "Meeting" },
  campaign: { icon: "sparkles", tone: "pink", label: "Campaign" },
};
const TITLE_TYPE: Record<string, RecordType> = { clients: "client", leads: "lead", invoices: "invoice", quotations: "quote", contracts: "contract", projects: "project", vendors: "vendor", people: "staff", tasks: "task" };
export const recordTypeFromTitle = (title: string): RecordType | null => TITLE_TYPE[title.toLowerCase()] ?? null;
const HREF_TYPE: [RegExp, RecordType][] = [
  [/^\/clients\b/, "client"], [/^\/(leads|pipeline)\b/, "lead"], [/[?&]task=|^\/projects\/[^/?]+\/tasks|^\/me\/tasks/, "task"], [/^\/projects\b/, "project"],
  [/^\/finance\/invoices\b|^\/portal\/invoices\b/, "invoice"], [/^\/finance\/payments\b|^\/portal\/receipts\b/, "payment"], [/^\/quotes\b|^\/portal\/quotes\b/, "quote"],
  [/^\/contracts\b|^\/agreements\b/, "contract"], [/^\/vendors\b|^\/vendor\b/, "vendor"], [/^\/(hr|users|me|payroll|payslips)\b/, "staff"], [/^\/(meetings|room)\b/, "meeting"], [/^\/(campaigns|clout)\b/, "campaign"],
];
export const recordTypeFromHref = (href: string | null | undefined): RecordType | null => (href ? HREF_TYPE.find(([re]) => re.test(href))?.[1] ?? null : null);
