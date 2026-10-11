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
  "crm.view": "View own assigned leads",
  "crm.view_all": "View all leads and the full pipeline",
  "crm.edit": "Create and edit leads, move pipeline stages",
  "crm.convert": "Approve Closed Won and convert a lead into a client",
  "catalog.view": "View the service catalog and pricing",
  "catalog.edit": "Edit services, plans and prices",
  "projects.view": "View projects you are assigned to",
  "projects.view_all": "View all projects",
  "projects.manage": "Create projects, assign teams and tasks",
  "tasks.edit": "Update status of tasks in your projects",
  "clients.view": "View client accounts",
  "clients.edit": "Create and edit client accounts",
  "finance.view": "View ledgers, invoices, payments and reports",
  "finance.post": "Create and issue invoices, record payments",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

type RoleDef = { key: string; name: string; permissions: PermissionKey[] | "ALL" };

// Initial roles from the spec, with the permissions that exist so far.
// New modules add their own permissions and extend these mappings.
export const ROLE_DEFS: RoleDef[] = [
  { key: "SUPER_ADMIN", name: "Super Admin", permissions: "ALL" },
  { key: "CEO", name: "CEO / Director", permissions: ["dashboard.view", "settings.company.view", "bank.view", "users.view", "audit.view", "crm.view", "crm.view_all", "catalog.view", "clients.view", "finance.view", "projects.view", "projects.view_all"] },
  { key: "MARKETING_DIRECTOR", name: "Marketing Director", permissions: ["dashboard.view", "crm.view", "crm.view_all", "catalog.view", "catalog.edit"] },
  { key: "BRANCH_MANAGER", name: "Branch Manager", permissions: ["dashboard.view", "users.view"] },
  { key: "FINANCE_MANAGER", name: "Finance Manager", permissions: ["dashboard.view", "settings.company.view", "bank.view", "bank.view_full", "bank.edit", "clients.view", "clients.edit", "finance.view", "finance.post"] },
  { key: "ACCOUNTANT", name: "Accountant", permissions: ["dashboard.view", "bank.view", "clients.view", "clients.edit", "finance.view", "finance.post"] },
  { key: "HR_MANAGER", name: "HR Manager", permissions: ["dashboard.view", "users.view"] },
  { key: "PAYROLL_OFFICER", name: "Payroll Officer", permissions: ["dashboard.view"] },
  { key: "SALES_MANAGER", name: "Sales Manager", permissions: ["dashboard.view", "crm.view", "crm.view_all", "crm.edit", "crm.convert", "catalog.view", "clients.view"] },
  { key: "SALES_AGENT", name: "Sales Agent", permissions: ["dashboard.view", "crm.view", "crm.edit", "catalog.view"] },
  { key: "SUCCESS_MANAGER", name: "Success Manager", permissions: ["dashboard.view", "projects.view", "tasks.edit"] },
  { key: "PROJECT_MANAGER", name: "Project Manager", permissions: ["dashboard.view", "projects.view", "projects.manage", "tasks.edit", "clients.view"] },
  { key: "ADS_MANAGER", name: "Ads Manager", permissions: ["dashboard.view", "projects.view", "tasks.edit"] },
  { key: "ADS_EXPERT", name: "Ads Expert", permissions: ["dashboard.view", "projects.view", "tasks.edit"] },
  { key: "GRAPHIC_DESIGNER", name: "Graphic Designer", permissions: ["dashboard.view", "projects.view", "tasks.edit"] },
  { key: "VIDEO_EDITOR", name: "Video Editor", permissions: ["dashboard.view", "projects.view", "tasks.edit"] },
  { key: "WEB_DEVELOPER", name: "Web Developer", permissions: ["dashboard.view", "projects.view", "tasks.edit"] },
  { key: "AI_ENGINEER", name: "AI Engineer", permissions: ["dashboard.view", "projects.view", "tasks.edit"] },
  { key: "INTERN", name: "Intern", permissions: ["dashboard.view", "projects.view", "tasks.edit"] },
  { key: "CLIENT", name: "Client", permissions: [] },
  { key: "VENDOR", name: "Vendor", permissions: [] },
  { key: "BUSINESS_PARTNER", name: "Business Partner", permissions: [] },
  { key: "INVESTOR", name: "Investor", permissions: [] },
];
