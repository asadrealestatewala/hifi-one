// What the Ask assistant knows about using Hifi One itself. It is built from the same lists the menu and the Help & guide page use
// (so it cannot drift), plus a short set of hand-written explanations for things that are not a menu item: how each kind of person
// signs in, how invitations work, and what the portals show. Everything is filtered by the asking person's permissions, so Ask only
// guides someone to screens their role can open and says "ask an administrator" for the rest.
import { visibleNav } from "../components/shell/nav";
import { GROUPS, TASKS, TIPS } from "./help-content";

type Topic = { title: string; permission: string | null; text: string };

// Keep these true to the code (src/lib/portal.ts, src/lib/auth.ts, src/app/login). permission = who it is useful to; null = everyone.
export const TOPICS: Topic[] = [
  { title: "How a client signs in to the client portal", permission: null,
    text: "Clients do not sign up themselves. A staff member with client edit rights opens Services & clients → Clients → the client → Portal access and creates an invitation. That makes a one-time link, valid for 7 days, which the staff member sends to the client. The client opens the link, types their name, chooses a password of at least 10 characters, and the account is created. After that they sign in at the normal sign-in page (the same address staff use) with the email or phone number the invitation was made for, plus their password, and are taken straight to the client portal. If the link expired or was used, staff create a new one. Forgotten passwords use Reset your password on the sign-in page." },
  { title: "What a client sees in the portal", permission: null,
    text: "Overview, Projects (progress, shared tasks, messages to the team, updates the team marked as visible), Content (approvals), Quotations, Meetings, Updates (notifications), Statement (with PDF and CSV download), invoices and receipts, and support requests. Everything is limited to their own company; they never see other clients or internal notes." },
  { title: "How a vendor signs in to the vendor portal", permission: null,
    text: "Same idea as clients. Staff open Procurement & vendors → Vendors → the vendor → Portal access and create a one-time invitation link (valid 7 days) for the vendor's email. The vendor creates a password from the link and then signs in on the normal sign-in page and lands in the vendor portal: Opportunities, Work and bills, Statement, Profile (they can change only email and phone) and Updates." },
  { title: "How staff sign in for the first time", permission: null,
    text: "New staff get no password. Someone who manages users creates a one-time setup link (valid 72 hours) from the staff record and sends it to them; the person chooses their own password. Sign-in is by email or phone number plus password. If a staff member forgets the password, use Reset your password on the sign-in page. Two-step sign-in is optional, switched on under Account security, and an administrator can require it for particular roles." },
  { title: "Partners", permission: null,
    text: "Reseller partners apply on the public Partner Stack page. Once approved they get a partner login and land in the partner portal (/partner) with their clients, commissions, Academy training and certificates." },
  { title: "Why a page says you do not have access", permission: null,
    text: "Every screen checks the person's role on the server. If a menu item or page is missing, the role does not include it. An administrator with Users & roles access can change what a role can do under Administration → Users & roles → Roles; it takes effect at the person's next sign-in." },
  { title: "Where integrations and API keys are entered", permission: "settings.company.view",
    text: "Administration → Settings → Integrations (super admin). Keys are stored encrypted and never shown again. The Anthropic (Claude) key powers this assistant and Partner Academy question drafting." },
];

export function buildGuide(permissions: ReadonlySet<string>) {
  const menu = visibleNav(permissions).map((g) => ({ group: g.title, screens: g.items.map((i) => `${i.label} (${i.href})`) }));
  const jobs = GROUPS.map(([id, title]) => ({
    section: title,
    jobs: TASKS.filter((t) => t.group === id && (t.permission === null || permissions.has(t.permission))).map((t) => `${t.title}: ${t.why} [${t.href}]`),
  })).filter((g) => g.jobs.length > 0);
  const topics = TOPICS.filter((t) => t.permission === null || permissions.has(t.permission)).map((t) => ({ topic: t.title, answer: t.text }));
  return {
    note: "Menu and jobs below are only what this person's role can open. If the answer is not here, say you do not know and suggest asking an administrator. Never invent screens or buttons.",
    menu, jobs, tips: TIPS.map(([k, v]) => `${k}: ${v}`), topics,
  };
}
