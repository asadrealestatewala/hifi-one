// One accent colour per module, shared by the sidebar chips and the tab strip.
export const MODULE_COLOR: Record<string, string> = {
  overview: "#5648e8", crm: "#8b5cf6", clients: "#2563eb", projects: "#f97316", finance: "#059669", people: "#e11d74", vendors: "#d97706", me: "#0d9488", admin: "#64748b",
};

// One icon per menu entry (by label), so every entry is recognisable at a glance. Unlisted labels fall back to a guess.
export const ENTRY_ICON: Record<string, string> = {
  Dashboard: "home", Search: "search", Approvals: "check", Mailbox: "mail", Assistant: "sparkles",
  Contacts: "users", Leads: "target", Opportunities: "chart", Prospector: "search", "Field visits": "pin", Campaigns: "sparkles", "Clout Leader": "activity", "Proposals & quotations": "file", "Sales reports": "chart",
  "Partner Stack": "link",
  "Service catalog": "layers", Clients: "building", Retainers: "clock", Contracts: "file", "Support requests": "chat", Billing: "receipt",
  Projects: "briefcase", "Content calendar": "calendar", "Team chat": "chat", Meetings: "video",
  Books: "file", "Expense vouchers": "receipt", "Bank reconciliation": "wallet", Budgets: "chart", Commissions: "wallet", "Financial reports": "chart", "Assets & investments": "building",
  "Staff directory": "users", "Staff activity": "activity", "Requests & notices": "bell", Hiring: "user", Payroll: "wallet",
  Vendors: "truck", "Orders & bills": "receipt",
  "My day": "sun", "My attendance": "clock", "My tasks": "check", "My team": "users", "My leave": "calendar", "My payslips": "receipt", "My profile": "user",
  Settings: "settings", "Users & roles": "key", "Audit & security": "shield",
};
