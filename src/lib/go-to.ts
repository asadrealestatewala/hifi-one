import type { PermissionKey } from "@/lib/permissions";
import { NAV } from "../components/shell/nav";
import { screenGroup } from "../components/shell/screen-groups";
import { MY_SPACE_GROUPS } from "./my-space";

// "Go to": every screen a person may open, including the tabs inside a menu entry and the screens on the Settings and
// My day pages, each with the path that leads to it ("People & HR → Staff activity → Attendance"). Built on the server
// from the same rules as the menu, so search never offers a screen the person could not open.
export type Destination = { href: string; label: string; trail: string[]; icon: string; words: string };

// Tabs that live inside one page (a ?view= or ?type= switch) rather than in a screen group.
const IN_PAGE: { href: string; label: string; trail: string[]; icon: string; permission: PermissionKey }[] = [
  { href: "/projects?view=tasks", label: "Tasks", trail: ["Project operations", "Projects"], icon: "briefcase", permission: "projects.view" },
  ...([["pl", "Profit & Loss"], ["bs", "Balance Sheet"], ["cpl", "Consolidated P&L"], ["cbs", "Consolidated Balance Sheet"], ["cash", "Cash Movement"], ["aging", "Receivables Aging"], ["ap", "Payables Aging"], ["tax", "Sales Tax"]] as const)
    .map(([k, label]) => ({ href: `/finance/reports?type=${k}`, label, trail: ["Finance & accounting", "Financial reports"], icon: "wallet", permission: "reports.view" as PermissionKey })),
];

// Everyday words people type for a screen whose title uses other words. Keyed by the screen's address.
// Keep each list to words someone would really type; a word may point at more than one screen.
export const GO_TO_WORDS: Record<string, string> = {
  "/dashboard": "home overview summary kpi",
  "/approvals": "approve pending waiting sign off",
  "/mail": "email inbox mailbox",
  "/assistant": "ai ask claude chatbot",
  "/contacts": "people phone numbers",
  "/leads": "enquiries inquiries prospects crm",
  "/pipeline": "deals pipeline opportunities stages",
  "/leads/prospector": "cold calling prospects import",
  "/leads/prospector/field-team": "agents field team targets commission per solution",
  "/leads/prospector/demos": "demo booking",
  "/field": "visit capture offline field agent",
  "/campaigns": "marketing email campaign broadcast",
  "/clout": "social influencer",
  "/quotes": "quotation proposal estimate",
  "/services": "services packages price list",
  "/clients": "customers accounts",
  "/engagements": "retainer monthly recurring",
  "/support": "tickets complaints help desk",
  "/finance/invoices": "bill billing invoice",
  "/finance/payments": "receipts payment received proof",
  "/finance/partner-payments": "reseller payments",
  "/finance/subscriptions": "recurring renewals saas",
  "/projects": "jobs work",
  "/projects?view=tasks": "to do todo assignments",
  "/content": "social posts calendar planner instagram facebook design",
  "/chat": "messages group chat call",
  "/meetings": "video call zoom",
  "/finance/ledger": "accounting gl ledger",
  "/finance/accounts": "coa accounts chart",
  "/finance/journals": "journal entry jv",
  "/finance/close": "lock month close",
  "/expenses": "expense claim reimbursement voucher",
  "/finance/reconciliation": "bank statement match",
  "/finance/budgets": "budget plan",
  "/finance/commissions": "commission agent payout",
  "/finance/reports": "p&l profit loss balance sheet statements",
  "/assets": "equipment depreciation laptop",
  "/hr/employees": "staff employees team people",
  "/hr/documents": "cnic id papers",
  "/hr/assets": "assets equipment laptop phone sim inventory items handover stock",
  "/hr/attendance": "clock in present absent late",
  "/hr/reports": "daily report work report",
  "/hr/reports/eod": "end of day eod",
  "/hr/scorecards": "performance ranking kpi",
  "/hr/visits": "site visit work from home wfh field work",
  "/hr/monitoring": "workfolio activity screenshots hours",
  "/hr/leave": "leave holiday vacation sick time off",
  "/hr/requests": "employee requests applications",
  "/hr/circulars": "notice announcement memo",
  "/hr/applications": "jobs candidates cv resume recruitment careers",
  "/hr/onboarding": "joining new hire",
  "/payroll": "salary salaries wages pay run",
  "/vendors": "suppliers",
  "/procurement": "purchase order po bills",
  "/me": "my day today home",
  "/me/attendance": "clock in clock out break",
  "/me/report": "daily report",
  "/me/calendar": "calendar feed",
  "/me/leave": "apply leave holiday vacation sick",
  "/me/payslips": "salary slip pay slip",
  "/me/profile": "photo picture",
  "/account/security": "password two step 2fa otp sessions",
  "/me/help": "guide how to help",
  "/site/app": "android apk phone app",
  "/settings": "setup configuration preferences",
  "/settings/company": "logo address stamp company name",
  "/settings/calendar": "holidays office hours working days lunch weekend saturday grace",
  "/settings/organization": "branches offices departments",
  "/settings/documents": "invoice template receipt design print",
  "/settings/bank-accounts": "bank iban",
  "/settings/tax-rates": "gst vat sales tax",
  "/settings/exchange-rates": "currency usd pkr fx",
  "/settings/email": "smtp sender email",
  "/settings/mailboxes": "mailbox inbox",
  "/settings/email-templates": "email wording",
  "/settings/integrations": "api keys anthropic google meta whatsapp",
  "/settings/duplicates": "duplicate merge",
  "/settings/quest": "game points streak",
  "/settings/monitoring": "tracking consent policy",
  "/settings/jobs": "cron schedule automation",
  "/users": "users accounts login invite",
  "/roles": "permissions access rights",
  "/audit-logs": "history activity log who changed",
  "/settings/security": "security checklist",
  "/partner-stack": "partners resellers",
  "/partner-stack/academy": "training course certification",
};

const allowed = (p: PermissionKey | null, permissions: ReadonlySet<string>) => p === null || permissions.has(p);

export function destinations(permissions: ReadonlySet<string>): Destination[] {
  const out: Destination[] = [];
  const seen = new Set<string>();
  const add = (href: string, label: string, trail: string[], icon: string) => {
    if (seen.has(href) || seen.has(`${href} ${label}`)) return;
    seen.add(`${href} ${label}`);
    out.push({ href, label, trail, icon, words: GO_TO_WORDS[href] ?? "" });
  };
  for (const g of NAV) {
    for (const i of g.items) {
      if (!i.group) { if (allowed(i.permission, permissions)) add(i.href, i.label, [g.title], g.icon); continue; }
      const sg = screenGroup(i.group);
      const tabs = sg.tabs.filter((t) => allowed(t.permission, permissions));
      if (tabs.length === 0) continue;
      // The menu entry itself ("Staff activity"), then each of its tabs ("Attendance") with the entry in its path
      if (sg.hub) { add(sg.hub, i.label, [g.title], g.icon); seen.add(sg.hub); }
      else if (!tabs.some((t) => t.label === i.label)) add(tabs[0].href, i.label, [g.title], g.icon);
      // A tab named like its menu entry ("Contracts → Contracts") is shown once, under the group only.
      for (const t of tabs) add(t.href, t.label, t.label === i.label ? [g.title] : [g.title, i.label], g.icon);
    }
  }
  for (const g of out.map((d) => d.href)) seen.add(g); // from here on, a screen already listed is not listed again
  for (const s of MY_SPACE_GROUPS) for (const e of s.entries) if (allowed(e.permission, permissions)) add(e.href, e.label, ["My space", "My day"], "user");
  for (const x of IN_PAGE) if (permissions.has(x.permission)) add(x.href, x.label, x.trail, x.icon);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Best first. Every typed word has to start a word somewhere in the screen's name, its path or its everyday words.
export function matchDestinations(list: Destination[], query: string, limit = 8): Destination[] {
  const q = norm(query);
  if (!q) return [];
  const qw = q.split(" ");
  const scored: { d: Destination; s: number }[] = [];
  for (const d of list) {
    const label = norm(d.label);
    const lw = label.split(" ");
    const tw = norm(d.trail.join(" ")).split(" ");
    const kw = norm(d.words).split(" ");
    const starts = (words: string[], w: string) => words.some((x) => x.startsWith(w) || (w.length > 3 && x.startsWith(w.replace(/s$/, ""))));
    if (!qw.every((w) => starts(lw, w) || starts(tw, w) || starts(kw, w) || label.includes(w))) continue;
    let s = 0;
    if (label === q) s = 100;
    else if (label.startsWith(q) || label === `my ${q}`) s = 80;
    else if (qw.every((w) => starts(lw, w))) s = 60;
    else if (label.includes(q)) s = 50;
    else if (qw.every((w) => kw.includes(w) || starts(lw, w))) s = 45; // the exact everyday word beats one that only starts with it
    else if (qw.every((w) => starts(kw, w) || starts(lw, w))) s = 40;
    else s = 20;
    s -= d.trail.length; // shallower screens first when equal
    scored.push({ d, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.d);
}
