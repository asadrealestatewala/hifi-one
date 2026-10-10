// Single source of truth for permission keys. Seeded into the database and
// checked on the server for every protected page and action.
export const PERMISSIONS = {
  "dashboard.view": "View the dashboard",
  "settings.company.view": "View company settings",
  "settings.company.edit": "Edit company settings",
  "bank.view": "View bank accounts (masked)",
  "bank.view_full": "View full bank account numbers",
  "bank.edit": "Add, edit and deactivate bank accounts",
  "users.view": "View users",
  "users.manage": "Create and edit users",
  "roles.manage": "Manage roles and permissions",
  "audit.view": "View audit logs",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

type RoleDef = { key: string; name: string; permissions: PermissionKey[] | "ALL" };

// Initial roles from the spec, with the permissions that exist so far.
// New modules add their own permissions and extend these mappings.
export const ROLE_DEFS: RoleDef[] = [
  { key: "SUPER_ADMIN", name: "Super Admin", permissions: "ALL" },
  { key: "CEO", name: "CEO / Director", permissions: ["dashboard.view", "settings.company.view", "bank.view", "users.view", "audit.view"] },
  { key: "MARKETING_DIRECTOR", name: "Marketing Director", permissions: ["dashboard.view"] },
  { key: "BRANCH_MANAGER", name: "Branch Manager", permissions: ["dashboard.view", "users.view"] },
  { key: "FINANCE_MANAGER", name: "Finance Manager", permissions: ["dashboard.view", "settings.company.view", "bank.view", "bank.view_full", "bank.edit"] },
  { key: "ACCOUNTANT", name: "Accountant", permissions: ["dashboard.view", "bank.view"] },
  { key: "HR_MANAGER", name: "HR Manager", permissions: ["dashboard.view", "users.view"] },
  { key: "PAYROLL_OFFICER", name: "Payroll Officer", permissions: ["dashboard.view"] },
  { key: "SALES_MANAGER", name: "Sales Manager", permissions: ["dashboard.view"] },
  { key: "SALES_AGENT", name: "Sales Agent", permissions: ["dashboard.view"] },
  { key: "SUCCESS_MANAGER", name: "Success Manager", permissions: ["dashboard.view"] },
  { key: "PROJECT_MANAGER", name: "Project Manager", permissions: ["dashboard.view"] },
  { key: "ADS_MANAGER", name: "Ads Manager", permissions: ["dashboard.view"] },
  { key: "ADS_EXPERT", name: "Ads Expert", permissions: ["dashboard.view"] },
  { key: "GRAPHIC_DESIGNER", name: "Graphic Designer", permissions: ["dashboard.view"] },
  { key: "VIDEO_EDITOR", name: "Video Editor", permissions: ["dashboard.view"] },
  { key: "WEB_DEVELOPER", name: "Web Developer", permissions: ["dashboard.view"] },
  { key: "AI_ENGINEER", name: "AI Engineer", permissions: ["dashboard.view"] },
  { key: "INTERN", name: "Intern", permissions: ["dashboard.view"] },
  { key: "CLIENT", name: "Client", permissions: [] },
  { key: "VENDOR", name: "Vendor", permissions: [] },
  { key: "BUSINESS_PARTNER", name: "Business Partner", permissions: [] },
  { key: "INVESTOR", name: "Investor", permissions: [] },
];
