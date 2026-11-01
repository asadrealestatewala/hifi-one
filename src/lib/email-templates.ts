// Branded email templates: the built-in catalogue and the renderer that turns a template plus variables into an email-client-safe
// HTML message and a plain-text twin. Pure (no database, no Node APIs) so the template editor can preview in the browser with
// exactly the code that sends. Layout rules for email clients: tables for structure, inline styles, a 600px column that becomes
// full width on phones, bulletproof buttons, web-safe fonts, and nothing that needs JavaScript or external CSS.

export type TemplateContent = {
  subject: string;
  preheader?: string | null; // the grey line inboxes show after the subject
  heading: string;
  body: string; // paragraphs separated by a blank line; "- " starts a bullet; **bold**; links are made clickable
  buttonLabel?: string | null;
  buttonUrl?: string | null;
  highlights?: string | null; // up to three lines "Title | text", shown as cards
};

export type Brand = {
  company: string;
  appUrl: string; // absolute, no trailing slash; the logo is loaded from here
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
};

export type StepItem = { title: string; text: string; done?: boolean; current?: boolean };

// The parts of a built-in email that are not free text: a code box, a progress bar, a details card, a checklist.
export type Blocks = {
  label?: string; // small caps text at the top right of the header, e.g. ACCOUNT SECURITY
  code?: string; // variable name holding a one-time code
  progress?: { percent: number; caption: string };
  details?: [label: string, value: string][]; // value may contain {{variables}}; empty rows are left out
  steps?: StepItem[];
  secondary?: { label: string; url: string }; // a quieter second button
};

export type TemplateDef = {
  key: string;
  name: string;
  description: string;
  audience: "Staff" | "Clients" | "Leads";
  defaults: TemplateContent;
  variables: Record<string, string>; // name -> sample value used in the preview and the test email
  blocks?: Blocks;
  buttonUrlVar?: string; // built-in emails link where the system decides; the editor shows the label only
};

export type RenderInput = {
  content: TemplateContent;
  vars: Record<string, string | null | undefined>;
  brand: Brand;
  blocks?: Blocks;
  buttonUrl?: string | null;
  unsubscribeUrl?: string | null;
  footerNote?: string | null;
};

export type Rendered = { subject: string; html: string; text: string };

// ---------- palette (Hifi brand: navy, indigo, the logo red as a thin accent) ----------
const C = {
  page: "#f3f4f8", navy: "#12163a", ink: "#1b1f3b", text: "#454b66", muted: "#7a809b", line: "#e6e8f0",
  primary: "#4a5cf5", primaryDark: "#3846d8", soft: "#eef0ff", softer: "#f7f8ff", red: "#e11d1d", ok: "#127a3c", okSoft: "#e8f6ee",
};
const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// ---------- text helpers ----------
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (s: string) => s.replace(/[\r\n\0]+/g, " ").replace(/\s+/g, " ").trim();

export const VARIABLE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
export function fill(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(VARIABLE, (_, name: string) => vars[name.toLowerCase()] ?? "");
}
export const variablesIn = (text: string) => [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1].toLowerCase()))];

// In a link, a variable that is the whole address (or its start) goes in as written; anywhere else its value is encoded, so
// "mailto:{{owner_email}}?subject=About {{service}}" stays one valid address whatever the values contain.
export function fillUrl(url: string, vars: Record<string, string | null | undefined>): string {
  return url.trim().replace(VARIABLE, (_, name: string, at: number) => {
    const val = vars[name.toLowerCase()] ?? "";
    return at === 0 ? val.trim() : encodeURIComponent(val).replace(/%40/g, "@");
  }).replace(/ /g, "%20");
}

// Links in the body and buttons may only be web or mail links, never javascript: and friends.
export function safeUrl(raw: string | null | undefined): string | null {
  const u = (raw ?? "").trim();
  if (!u) return null;
  if (/^(https?:\/\/|mailto:)/i.test(u) && !/[\s<>"']/.test(u)) return u;
  return null;
}

function inline(escaped: string): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink};">$1</strong>`)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, `<a href="$1" style="color:${C.primary};text-decoration:underline;">$1</a>`);
}

// Body text -> HTML paragraphs and bullet lists. Everything is escaped first, so a variable can never inject markup.
export function bodyHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const p = `margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.text};`;
  return blocks.map((b) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      const items = lines.map((l) => `<tr><td valign="top" style="padding:0 10px 8px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${C.primary};">&#9679;</td><td style="padding:0 0 8px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.text};">${inline(esc(l.replace(/^\s*[-•]\s+/, "")))}</td></tr>`).join("");
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${items}</table>`;
    }
    return `<p style="${p}">${lines.map((l) => inline(esc(l))).join("<br>")}</p>`;
  }).join("\n");
}

const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*•\s+/gm, "- ").trim();

export function parseHighlights(raw: string | null | undefined): { title: string; text: string }[] {
  return (raw ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).map((l) => {
    const [title, ...rest] = l.split("|");
    return { title: title.trim(), text: rest.join("|").trim() };
  }).filter((h) => h.title);
}

// ---------- building blocks ----------
function button(label: string, url: string, tone: "primary" | "ghost" = "primary") {
  const bg = tone === "primary" ? C.primary : "#ffffff";
  const fg = tone === "primary" ? "#ffffff" : C.primary;
  const border = C.line;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 24px;border-collapse:separate;"><tr>
<td align="center" bgcolor="${bg}" style="border-radius:999px;${tone === "ghost" ? `border:1px solid ${border};` : ""}mso-padding-alt:14px 32px;">
<a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:${fg};text-decoration:none;border-radius:999px;">${esc(label)}</a>
</td></tr></table>`;
}

function codeBox(code: string) {
  const spaced = esc(code).split("").join("&#8202;");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;border-collapse:separate;"><tr>
<td align="center" bgcolor="${C.soft}" style="border-radius:16px;padding:22px 12px;border:1px dashed #c7cdfb;">
<div style="font-family:${FONT};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${C.muted};margin:0 0 6px;">Your verification code</div>
<div style="font-family:'Courier New',Courier,monospace;font-size:36px;line-height:44px;font-weight:700;letter-spacing:10px;color:${C.navy};">${spaced}</div>
</td></tr></table>`;
}

function progressBar(percent: number, caption: string) {
  const p = Math.max(4, Math.min(100, Math.round(percent)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
<tr><td style="font-family:${FONT};font-size:13px;color:${C.muted};padding:0 0 8px;">${esc(caption)}</td><td align="right" style="font-family:${FONT};font-size:13px;font-weight:700;color:${C.primary};padding:0 0 8px;">${p}%</td></tr>
<tr><td colspan="2"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:999px;background:${C.line};"><tr>
<td width="${p}%" height="10" bgcolor="${C.primary}" style="border-radius:999px;background:${C.primary};background-image:linear-gradient(90deg,${C.primary},#7b8cff);font-size:0;line-height:0;">&nbsp;</td>
${p < 100 ? `<td width="${100 - p}%" height="10" style="font-size:0;line-height:0;">&nbsp;</td>` : ""}
</tr></table></td></tr></table>`;
}

function detailsCard(rows: [string, string][]) {
  if (!rows.length) return "";
  const body = rows.map(([k, v], i) => `<tr><td style="padding:10px 16px;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${FONT};font-size:13px;color:${C.muted};width:38%;" valign="top">${esc(k)}</td><td style="padding:10px 16px;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink};" valign="top">${esc(v)}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border:1px solid ${C.line};border-radius:14px;background:${C.softer};border-collapse:separate;">${body}</table>`;
}

function highlightCards(items: { title: string; text: string }[]) {
  if (!items.length) return "";
  const icons = ["&#10022;", "&#9670;", "&#10148;"];
  const w = Math.floor(100 / items.length);
  const cells = items.map((h, i) => `<td class="stack" width="${w}%" valign="top" style="padding:0 6px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" bgcolor="${C.softer}" style="border-radius:14px;border:1px solid ${C.line};padding:20px 14px;">
<div style="font-size:22px;line-height:26px;color:${C.primary};margin:0 0 8px;">${icons[i]}</div>
<div style="font-family:${FONT};font-size:15px;font-weight:700;color:${C.ink};margin:0 0 6px;">${esc(h.title)}</div>
${h.text ? `<div style="font-family:${FONT};font-size:13px;line-height:19px;color:${C.text};">${esc(h.text)}</div>` : ""}
</td></tr></table></td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 12px;"><tr>${cells}</tr></table>`;
}

function stepsSection(steps: StepItem[]) {
  const rows = steps.map((s, i) => {
    const mark = s.done ? `<td width="34" valign="top"><div style="width:26px;height:26px;border-radius:13px;background:${C.ok};color:#fff;font-family:${FONT};font-size:14px;line-height:26px;text-align:center;">&#10003;</div></td>`
      : `<td width="34" valign="top"><div style="width:24px;height:24px;border-radius:13px;border:1px solid ${s.current ? C.primary : "#c9cde0"};color:${s.current ? C.primary : C.muted};font-family:${FONT};font-size:13px;font-weight:700;line-height:24px;text-align:center;">${i + 1}</div></td>`;
    const titleStyle = s.done ? `color:${C.muted};text-decoration:line-through;` : `color:${C.ink};`;
    return `<tr><td style="padding:0 0 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td bgcolor="#ffffff" style="border-radius:14px;padding:14px 16px;border:1px solid ${s.current ? "#c7cdfb" : C.line};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${mark}<td valign="top">
<div style="font-family:${FONT};font-size:15px;font-weight:700;${titleStyle}">${esc(s.title)}${s.current ? ` <span style="font-size:11px;font-weight:700;color:${C.primary};background:${C.soft};border-radius:999px;padding:2px 8px;">NEXT</span>` : ""}</div>
<div style="font-family:${FONT};font-size:13px;line-height:19px;color:${C.text};">${esc(s.text)}</div>
</td></tr></table></td></tr></table></td></tr>`;
  }).join("");
  return `<tr><td class="px" bgcolor="${C.soft}" style="padding:28px 40px 22px;background:${C.soft};">
<div style="font-family:${FONT};font-size:17px;font-weight:700;color:${C.navy};text-align:center;margin:0 0 16px;">Your onboarding checklist</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>`;
}

// ---------- the whole message ----------
export function renderEmail(i: RenderInput): Rendered {
  const v = i.vars;
  const subject = oneLine(fill(i.content.subject, v)).slice(0, 200) || i.brand.company;
  const heading = oneLine(fill(i.content.heading, v));
  const preheader = oneLine(fill(i.content.preheader ?? "", v));
  const body = fill(i.content.body, v);
  const b = i.blocks ?? {};
  const code = b.code ? (v[b.code] ?? "") : "";
  const details = (b.details ?? []).map(([k, val]) => [k, oneLine(fill(val, v))] as [string, string]).filter(([, val]) => val);
  const btnUrl = safeUrl(i.buttonUrl ?? fillUrl(i.content.buttonUrl ?? "", v));
  const btnLabel = oneLine(fill(i.content.buttonLabel ?? "", v));
  const secondary = b.secondary ? { label: fill(b.secondary.label, v), url: safeUrl(fillUrl(b.secondary.url, v)) } : null;
  const highlights = parseHighlights(fill(i.content.highlights ?? "", v));
  const unsub = safeUrl(i.unsubscribeUrl);
  const logo = `${i.brand.appUrl.replace(/\/$/, "")}/logo.png`;
  const contact = [i.brand.address, i.brand.phone, i.brand.email].filter(Boolean).map((x) => esc(String(x))).join(" &middot; ");
  const site = safeUrl(i.brand.website ? (/^https?:/i.test(i.brand.website) ? i.brand.website : `https://${i.brand.website}`) : null);

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;} img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
a{color:${C.primary};}
@media only screen and (max-width:620px){
 .container{width:100%!important;max-width:100%!important;}
 .px{padding-left:22px!important;padding-right:22px!important;}
 .stack{display:block!important;width:100%!important;padding:0 0 12px!important;}
 .h1{font-size:25px!important;line-height:32px!important;}
 .hide-sm{display:none!important;}
}
</style></head>
<body style="margin:0;padding:0;background:${C.page};" bgcolor="${C.page}">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${esc(preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 6px 28px rgba(18,22,58,0.08);">
<tr><td height="4" bgcolor="${C.red}" style="font-size:0;line-height:0;background:${C.red};background-image:linear-gradient(90deg,${C.red},${C.primary});">&nbsp;</td></tr>
<tr><td class="px" bgcolor="${C.navy}" style="padding:18px 40px;background:${C.navy};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><img src="${esc(logo)}" width="34" height="34" alt="" style="display:inline-block;vertical-align:middle;border-radius:8px;"><span style="font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;vertical-align:middle;padding-left:10px;">${esc(i.brand.company)}</span></td>
${b.label ? `<td class="hide-sm" align="right" valign="middle" style="font-family:${FONT};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#aeb4da;">${esc(b.label)}</td>` : ""}
</tr></table></td></tr>
<tr><td class="px" align="center" style="padding:40px 40px 30px;background:${C.soft};background-image:linear-gradient(180deg,#f3f5ff 0%,#dfe6ff 55%,#ffffff 100%);">
<h1 class="h1" style="margin:0;font-family:${FONT};font-size:30px;line-height:38px;font-weight:800;color:${C.navy};letter-spacing:-0.4px;">${esc(heading)}</h1>
${preheader ? `<p style="margin:12px auto 0;max-width:460px;font-family:${FONT};font-size:16px;line-height:24px;color:${C.text};">${esc(preheader)}</p>` : ""}
</td></tr>
<tr><td class="px" style="padding:12px 40px 12px;">
${b.progress ? progressBar(b.progress.percent, b.progress.caption) : ""}
${code ? codeBox(code) : ""}
${bodyHtml(body)}
${detailsCard(details)}
${btnUrl && btnLabel ? button(btnLabel, btnUrl) : ""}
${secondary?.url ? button(secondary.label, secondary.url, "ghost") : ""}
${highlightCards(highlights)}
</td></tr>
${b.steps?.length ? stepsSection(b.steps) : ""}
<tr><td class="px" style="padding:22px 40px 28px;border-top:1px solid ${C.line};" align="center">
<p style="margin:0 0 6px;font-family:${FONT};font-size:13px;font-weight:700;color:${C.ink};">${esc(i.brand.company)}</p>
${contact ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">${contact}</p>` : ""}
${site ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;"><a href="${esc(site)}" style="color:${C.primary};text-decoration:none;">${esc(site.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></p>` : ""}
${i.footerNote ? `<p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">${esc(i.footerNote)}</p>` : ""}
${unsub ? `<p style="margin:10px 0 0;font-family:${FONT};font-size:12px;color:${C.muted};">Not interested? <a href="${esc(unsub)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a></p>` : ""}
</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    heading, preheader, "",
    code ? `Your verification code: ${code}\n` : "",
    plain(body), "",
    details.length ? details.map(([k, val]) => `${k}: ${val}`).join("\n") + "\n" : "",
    btnUrl && btnLabel ? `${btnLabel}: ${btnUrl}\n` : "",
    secondary?.url ? `${secondary.label}: ${secondary.url}\n` : "",
    highlights.length ? highlights.map((h) => `- ${h.title}${h.text ? `: ${h.text}` : ""}`).join("\n") + "\n" : "",
    b.steps?.length ? b.steps.map((s, n) => `${s.done ? "[x]" : "[ ]"} ${n + 1}. ${s.title}`).join("\n") + "\n" : "",
    "--", i.brand.company, contact.replace(/&middot;/g, "·").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
    i.footerNote ?? "",
    unsub ? `Unsubscribe: ${unsub}` : "",
  ].filter((l, n, a) => !(l === "" && a[n - 1] === "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { subject, html, text };
}

// ---------- built-in catalogue ----------
const ONBOARDING_STEPS = (current: number): StepItem[] => [
  { title: "Verify your email", text: "Enter the code from this email so we know it reaches you." },
  { title: "Choose your password", text: "Pick a password of at least 10 characters." },
  { title: "Approval", text: "A manager confirms your account. We email you as soon as it is done." },
  { title: "Sign in and get started", text: "Your tasks, mailbox and My Space are ready for you." },
].map((s, i) => ({ ...s, done: i < current, current: i === current }));

export const SYSTEM_TEMPLATES: TemplateDef[] = [
  {
    key: "onboarding_code", name: "Onboarding: verification code", audience: "Staff",
    description: "Sent to a new staff member when their account is created. The code proves the email is theirs; the button opens the page where they enter it and choose a password.",
    variables: { first_name: "Ayesha", name: "Ayesha Malik", code: "482913", company_name: "Hifi Marketing and Technologies", link: "https://hifimarketing.co/onboarding/sample", code_hours: "24", requested_by: "Asad B Zaman" },
    blocks: { label: "Welcome aboard", code: "code", progress: { percent: 25, caption: "Step 1 of 4" }, steps: ONBOARDING_STEPS(0) },
    buttonUrlVar: "link",
    defaults: {
      subject: "{{code}} is your {{company_name}} verification code",
      preheader: "Confirm your email to finish setting up your account.",
      heading: "Welcome to the team, {{first_name}}!",
      body: "{{requested_by}} has created your {{company_name}} account. To finish setting it up, confirm your email with the code above.\n\nThe code works for {{code_hours}} hours. Never share it with anyone: our team will never ask you for it.",
      buttonLabel: "Verify and set up my account",
    },
  },
  {
    key: "onboarding_approval_request", name: "Onboarding: approval request", audience: "Staff",
    description: "Sent to everyone who can approve new staff, once the person has verified their email (or straight away when they have no email).",
    variables: { approver_first_name: "Asad", name: "Ayesha Malik", email: "ayesha@example.com", roles: "Sales Agent", department: "Sales", designation: "Business Developer", requested_by: "HR Coordinator", verified: "Email verified with a code", link: "https://hifimarketing.co/hr/onboarding", company_name: "Hifi Marketing and Technologies" },
    blocks: { label: "Approval needed", details: [["New team member", "{{name}}"], ["Email", "{{email}}"], ["Role", "{{roles}}"], ["Department", "{{department}}"], ["Designation", "{{designation}}"], ["Added by", "{{requested_by}}"], ["Verification", "{{verified}}"]] },
    buttonUrlVar: "link",
    defaults: {
      subject: "Approve {{name}}'s account",
      preheader: "A new team member is waiting for your approval before they can sign in.",
      heading: "{{name}} is ready for approval",
      body: "Hi {{approver_first_name}},\n\nA new staff account is waiting for you. They cannot sign in until someone approves it. Check the details below, then approve or reject the account.",
      buttonLabel: "Review and approve",
    },
  },
  {
    key: "onboarding_approved", name: "Onboarding: welcome (approved)", audience: "Staff",
    description: "Sent to the new staff member when their account is approved.",
    variables: { first_name: "Ayesha", company_name: "Hifi Marketing and Technologies", link: "https://hifimarketing.co/login", approved_by: "Asad B Zaman", login: "ayesha@example.com" },
    blocks: { label: "You're in", progress: { percent: 100, caption: "Onboarding complete" } },
    buttonUrlVar: "link",
    defaults: {
      subject: "You're all set, {{first_name}}. Welcome to {{company_name}}",
      preheader: "Your account is approved. Sign in and get started.",
      heading: "You're all set, {{first_name}}!",
      body: "Good news: {{approved_by}} approved your account. You can now sign in with **{{login}}** and the password you chose.\n\nHere is what is waiting for you inside:",
      buttonLabel: "Sign in to Hifi One",
      highlights: "Your tasks | Everything assigned to you, with due dates and reminders\nYour mailbox | Read and send company email from one place\nMy Space | Attendance, leave, payslips and your profile",
    },
  },
  {
    key: "onboarding_rejected", name: "Onboarding: not approved", audience: "Staff",
    description: "Sent to the person when an approver rejects the account.",
    variables: { first_name: "Ayesha", company_name: "Hifi Marketing and Technologies", note: "We will contact you about the start date." },
    blocks: { label: "Account update", details: [["Note from the team", "{{note}}"]] },
    defaults: {
      subject: "Your {{company_name}} account",
      preheader: "An update about your account request.",
      heading: "Your account was not activated",
      body: "Hi {{first_name}},\n\nThe account that was set up for you at {{company_name}} has not been approved. If you think this is a mistake, please contact the person who added you or reply to this email.",
      buttonLabel: null,
    },
  },
  {
    key: "task_assigned", name: "Task assigned", audience: "Staff",
    description: "Sent to the person a task is assigned to, alongside the in-app notification.",
    variables: { first_name: "Bilal", task_title: "Call back Acme about the Q3 proposal", project: "Acme Retainer", priority: "High", due_date: "2026-11-05", assigned_by: "Sara Khan", description: "They asked for pricing on the video package.", link: "https://hifimarketing.co/projects/sample", company_name: "Hifi Marketing and Technologies" },
    blocks: { label: "New task", details: [["Task", "{{task_title}}"], ["Project", "{{project}}"], ["Priority", "{{priority}}"], ["Due", "{{due_date}}"], ["Assigned by", "{{assigned_by}}"]] },
    buttonUrlVar: "link",
    defaults: {
      subject: "New task: {{task_title}}",
      preheader: "{{assigned_by}} assigned you a task in {{project}}.",
      heading: "You have a new task",
      body: "Hi {{first_name}},\n\n{{assigned_by}} assigned a task to you. {{description}}",
      buttonLabel: "Open the task",
    },
  },
  {
    key: "lead_assigned", name: "Lead assigned", audience: "Staff",
    description: "Sent to a salesperson when a lead is assigned to them (by a colleague or by a website form's assignment rule).",
    variables: { first_name: "Bilal", lead_name: "Omar Siddiqui", lead_company: "Acme Traders", lead_email: "omar@acme.example", lead_phone: "+923001234567", source: "Website: Contact form", link: "https://hifimarketing.co/leads/sample", company_name: "Hifi Marketing and Technologies" },
    blocks: { label: "New lead", details: [["Lead", "{{lead_name}}"], ["Company", "{{lead_company}}"], ["Email", "{{lead_email}}"], ["Phone", "{{lead_phone}}"], ["Source", "{{source}}"]] },
    buttonUrlVar: "link",
    defaults: {
      subject: "New lead for you: {{lead_name}}",
      preheader: "A new lead is waiting for your first call.",
      heading: "A new lead is yours",
      body: "Hi {{first_name}},\n\n**{{lead_name}}** has been assigned to you. Leads contacted within the first hour are far more likely to convert, so reach out soon.",
      buttonLabel: "Open the lead",
    },
  },
  {
    key: "password_reset", name: "Password reset", audience: "Staff",
    description: "Sent when someone asks for a new password from the sign-in page.",
    variables: { first_name: "Ayesha", link: "https://hifimarketing.co/reset/sample", company_name: "Hifi Marketing and Technologies" },
    blocks: { label: "Account security" },
    buttonUrlVar: "link",
    defaults: {
      subject: "Reset your Hifi One password",
      preheader: "The link works for one hour.",
      heading: "Reset your password",
      body: "Hi {{first_name}},\n\nSomeone asked to reset the Hifi One password for this address. Choose a new one with the button below. The link works for one hour.\n\nIf it was not you, ignore this email: your password stays the same.",
      buttonLabel: "Choose a new password",
    },
  },
  {
    key: "invoice_sent", name: "Invoice email", audience: "Clients",
    description: "The message that carries an invoice PDF to a client.",
    variables: { client_name: "Acme Traders", number: "INV-0042", amount: "USD 1,250.00", due_date: "2026-11-15", balance: "", company_name: "Hifi Marketing and Technologies", portal_link: "https://hifimarketing.co/portal" },
    blocks: { label: "Billing", details: [["Invoice", "{{number}}"], ["Amount", "{{amount}}"], ["Due date", "{{due_date}}"], ["Balance outstanding", "{{balance}}"]] },
    buttonUrlVar: "portal_link",
    defaults: {
      subject: "Invoice {{number}} from {{company_name}}",
      preheader: "Your invoice is attached as a PDF.",
      heading: "Your invoice is ready",
      body: "Dear {{client_name}},\n\nPlease find invoice {{number}} attached. Payment details are on the invoice. If you have any questions, just reply to this email.",
      buttonLabel: "View in your client portal",
    },
  },
  {
    key: "quote_sent", name: "Quotation email", audience: "Clients",
    description: "The message that carries a quotation PDF to a client.",
    variables: { client_name: "Acme Traders", number: "Q-0017", amount: "USD 3,400.00", valid_until: "2026-11-30", company_name: "Hifi Marketing and Technologies", portal_link: "https://hifimarketing.co/portal" },
    blocks: { label: "Proposal", details: [["Quotation", "{{number}}"], ["Total", "{{amount}}"], ["Valid until", "{{valid_until}}"]] },
    buttonUrlVar: "portal_link",
    defaults: {
      subject: "Quotation {{number}} from {{company_name}}",
      preheader: "Your quotation is attached as a PDF.",
      heading: "Your quotation is ready",
      body: "Dear {{client_name}},\n\nThank you for your interest. Please find quotation {{number}} attached. You can accept it from your client portal or simply reply to this email.",
      buttonLabel: "Review in your client portal",
    },
  },
  {
    key: "statement_sent", name: "Account statement email", audience: "Clients",
    description: "The message that carries an account statement PDF to a client.",
    variables: { client_name: "Acme Traders", as_of: "2026-10-31", company_name: "Hifi Marketing and Technologies", portal_link: "https://hifimarketing.co/portal" },
    blocks: { label: "Billing", details: [["Statement date", "{{as_of}}"]] },
    buttonUrlVar: "portal_link",
    defaults: {
      subject: "Account statement from {{company_name}}",
      preheader: "Your account statement is attached as a PDF.",
      heading: "Your account statement",
      body: "Dear {{client_name}},\n\nPlease find your account statement attached. If anything looks wrong, reply to this email and we will check it.",
      buttonLabel: "Open your client portal",
    },
  },
];

export const systemTemplate = (key: string) => SYSTEM_TEMPLATES.find((t) => t.key === key) ?? null;

// Variables every follow-up email can use, with preview samples.
export const FOLLOW_UP_VARIABLES: Record<string, string> = {
  first_name: "Omar", lead_name: "Omar Siddiqui", lead_company: "Acme Traders", service: "Social media marketing",
  owner_name: "Bilal Ahmed", owner_first_name: "Bilal", owner_email: "bilal@hifimarketing.co", owner_phone: "+923001234567",
  company_name: "Hifi Marketing and Technologies", website: "https://hifimarketing.co",
};

// Starter follow-up series (day 0, 2, 5 and 10), created when someone sets up their first sequence.
export const STARTER_FOLLOW_UPS: { key: string; name: string; delayDays: number; content: TemplateContent }[] = [
  {
    key: "followup_welcome", name: "Follow-up 1: thanks for reaching out", delayDays: 0,
    content: {
      subject: "Thanks for reaching out, {{first_name}}",
      preheader: "Here is what happens next.",
      heading: "Great to meet you, {{first_name}}",
      body: "Thank you for getting in touch with {{company_name}}. I'm {{owner_first_name}}, and I'll be your point of contact.\n\nOver the next day I'll look at what you need and come back with ideas that fit your goals and budget. If it's easier to talk, just reply with a good time to call.",
      buttonLabel: "Book a quick call", buttonUrl: "mailto:{{owner_email}}?subject=Call%20about%20{{service}}",
      highlights: "Strategy first | A plan built around your goals, not a template\nCreative that converts | Content, ads and design under one roof\nClear reporting | You always know what your budget is doing",
    },
  },
  {
    key: "followup_value", name: "Follow-up 2: how we help", delayDays: 2,
    content: {
      subject: "{{first_name}}, a few ideas for {{lead_company}}",
      preheader: "What we would do in your first 30 days.",
      heading: "Your first 30 days with us",
      body: "Hi {{first_name}},\n\nHere is how we usually start with businesses like yours:\n\n- **Week 1:** audit of your channels and competitors\n- **Week 2:** a content and ads plan with clear targets\n- **Weeks 3 and 4:** launch, measure and improve\n\nWould you like me to put a short proposal together for {{lead_company}}?",
      buttonLabel: "Yes, send me a proposal", buttonUrl: "mailto:{{owner_email}}?subject=Proposal%20for%20{{lead_company}}",
    },
  },
  {
    key: "followup_checkin", name: "Follow-up 3: quick check-in", delayDays: 5,
    content: {
      subject: "Quick question, {{first_name}}",
      preheader: "Is this still on your list?",
      heading: "Still thinking it over?",
      body: "Hi {{first_name}},\n\nI wanted to check whether {{service}} is still a priority for you this month. If the timing isn't right, no problem at all. If it is, a 15-minute call is usually enough to see whether we're a fit.\n\nYou can also reach me directly on {{owner_phone}}.",
      buttonLabel: "Reply to {{owner_first_name}}", buttonUrl: "mailto:{{owner_email}}",
    },
  },
  {
    key: "followup_last", name: "Follow-up 4: last note", delayDays: 10,
    content: {
      subject: "Should I close your file, {{first_name}}?",
      preheader: "Last email from me for now.",
      heading: "One last note from me",
      body: "Hi {{first_name}},\n\nI haven't heard back, so I'll assume now isn't the right time. I'll stop following up after this email.\n\nIf anything changes, just reply and we'll pick it up from where we left off. Wishing you and {{lead_company}} a great season.",
      buttonLabel: "Let's talk", buttonUrl: "mailto:{{owner_email}}",
    },
  },
];

export const TEMPLATE_LIMITS = { subject: 200, preheader: 200, heading: 160, body: 8000, buttonLabel: 60, buttonUrl: 500, highlights: 600, name: 120 } as const;
