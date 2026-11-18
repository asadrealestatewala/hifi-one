import type { PermissionKey } from "@/lib/permissions";

// Everything in My space, in the six groups a person actually thinks in. The sidebar carries the six; this page is
// where the rest live, so nothing is lost and nothing has to be hunted for.
export type MySpaceEntry = { href: string; label: string; what: string; permission: PermissionKey | null };
export const MY_SPACE_GROUPS: { id: string; title: string; icon: string; entries: MySpaceEntry[] }[] = [
  { id: "today", title: "Today", icon: "clock", entries: [
    { href: "/me/attendance", label: "My attendance", what: "Clock in, breaks, clock out, and the last two weeks.", permission: "self.attendance" },
    { href: "/me/report", label: "My daily report", what: "A short note at the end of each working day.", permission: "self.attendance" },
    { href: "/me/tasks", label: "My tasks", what: "Everything assigned to you, with due dates.", permission: null },
    { href: "/me/circulars", label: "Circulars", what: "Notices from HR and management addressed to you.", permission: null },
    { href: "/me/calendar", label: "My calendar", what: "Your days in a calendar, and a feed you can subscribe to.", permission: "self.leave" },
    { href: "/approvals", label: "Approvals", what: "Everything from anywhere in the system that is waiting for your word.", permission: null },
    { href: "/me/team", label: "My team", what: "The people who report to you: their day, and what of theirs is waiting.", permission: "leave.approve" },
  ] },
  { id: "time", title: "Time and attendance", icon: "clock", entries: [
    { href: "/me/time", label: "Time tracking", what: "Your hours and activity, and who has looked at them.", permission: "monitoring.own" },
    { href: "/me/visits", label: "Site visits", what: "Client visits, field work and days worked from home.", permission: "self.attendance" },
    { href: "/me/scorecard", label: "My scorecard", what: "Attendance, punctuality, report and output, day by day.", permission: "self.attendance" },
  ] },
  { id: "ask", title: "Asking for something", icon: "file", entries: [
    { href: "/me/leave", label: "My leave", what: "Your balance and your leave requests.", permission: "self.leave" },
    { href: "/me/requests", label: "My requests", what: "Certificates, advances, equipment, complaints: anything without a form of its own.", permission: "self.leave" },
    { href: "/expenses", label: "Expense vouchers", what: "Money you spent for work, with the receipt attached.", permission: "self.expense" },
  ] },
  { id: "pay", title: "Pay and papers", icon: "wallet", entries: [
    { href: "/me/payslips", label: "My payslips", what: "Every month you have been paid for, as a PDF.", permission: "self.payslip" },
    { href: "/me/commissions", label: "My commissions", what: "Earned, approved and paid.", permission: "commissions.own" },
    { href: "/me/documents", label: "My documents", what: "Identity, certificates and contracts you have given HR.", permission: "self.leave" },
  ] },
  { id: "tools", title: "Tools", icon: "chat", entries: [
    { href: "/mail", label: "Mailbox", what: "Your company email.", permission: null },
    { href: "/chat", label: "Team chat", what: "Messages, group chats and calls.", permission: "chat.use" },
    { href: "/assistant", label: "Assistant", what: "Questions about your data, answered from what you may see.", permission: "assistant.use" },
  ] },
  { id: "account", title: "Your account", icon: "user", entries: [
    { href: "/me/profile", label: "My profile", what: "Your picture, contact details and what colleagues see.", permission: null },
    { href: "/account/security", label: "Account security", what: "Password, two-step sign-in and your sessions.", permission: null },
    { href: "/me/help", label: "Help & guide", what: "Where each job is done, and a few tips.", permission: null },
    { href: "/site/app", label: "Mobile app", what: "The Android app and how to install it.", permission: null },
  ] },
];
