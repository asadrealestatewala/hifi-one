# Roles and permissions matrix

Generated from `src/lib/permissions.ts` by `npm run docs:roles`. Do not edit by hand.
A role grants a permission when it is listed; Super Admin holds every permission. Record-level rules (for example, sales agents see only their own leads) are enforced in addition to these permissions.

## Permissions

| Permission | What it allows |
|---|---|
| `dashboard.view` | View the dashboard |
| `settings.company.view` | View company settings |
| `settings.company.edit` | Edit company settings |
| `bank.view` | View bank accounts (masked) |
| `bank.view_full` | View full bank account numbers |
| `bank.edit` | Add, edit and deactivate bank accounts |
| `users.view` | View users |
| `users.manage` | Create and edit users |
| `roles.manage` | Manage roles and permissions |
| `audit.view` | View audit logs |
| `crm.view` | View own assigned leads |
| `crm.view_all` | View all leads and the full pipeline |
| `crm.edit` | Create and edit leads, move pipeline stages |
| `crm.convert` | Approve Closed Won and convert a lead into a client |
| `catalog.view` | View the service catalog and pricing |
| `catalog.edit` | Edit services, plans and prices |
| `projects.view` | View projects you are assigned to |
| `projects.view_all` | View all projects |
| `projects.manage` | Create projects, assign teams and tasks |
| `tasks.edit` | Update status of tasks in your projects |
| `self.attendance` | Clock in and out, take breaks |
| `self.leave` | Request and view own leave |
| `leave.approve` | Approve leave for your reports (or everyone, for HR) |
| `hr.view` | View the employee directory |
| `hr.manage` | Create and edit employee records |
| `hr.view_sensitive` | View identity and bank details of employees |
| `attendance.view_all` | View and correct everyone's attendance |
| `payroll.view` | View payroll runs, salary structures and payslips |
| `payroll.manage` | Set salaries and prepare payroll runs |
| `payroll.approve` | Approve payroll runs |
| `payroll.post` | Post payroll to the ledger and record salary payments |
| `self.payslip` | View own payslips |
| `self.expense` | Submit and track your own expense vouchers |
| `expenses.view` | View all expense vouchers |
| `expenses.review` | Review submitted expense vouchers |
| `expenses.approve` | Approve or reject expense vouchers |
| `expenses.post` | Post vouchers to the ledger and record payment |
| `budget.view` | View budgets and utilization |
| `budget.manage` | Create budgets and request transfers |
| `budget.approve` | Approve budget transfers |
| `budget.override` | Approve spending over budget with a reason |
| `vendors.view` | View vendors, opportunities, work orders and bills |
| `vendors.manage` | Manage vendors, publish opportunities, award and accept work |
| `vendors.bills` | Approve or reject vendor bills |
| `vendors.post` | Post vendor bills to the ledger and record payments |
| `assets.view` | View the fixed asset register |
| `assets.manage` | Register and assign assets |
| `assets.post` | Run depreciation and dispose of assets |
| `investments.view` | View investments |
| `investments.manage` | Create investments and record capital and income |
| `reports.view` | View financial statements and aging reports |
| `dashboard.executive` | View the executive dashboard |
| `content.view` | View the content calendar |
| `content.manage` | Create, edit and move content through review |
| `content.publish` | Schedule content and confirm it was published |
| `clients.view` | View client accounts |
| `clients.edit` | Create and edit client accounts |
| `finance.view` | View ledgers, invoices, payments and reports |
| `finance.post` | Create and issue invoices, record payments |

## Roles

### Super Admin

`dashboard.view`, `settings.company.view`, `settings.company.edit`, `bank.view`, `bank.view_full`, `bank.edit`, `users.view`, `users.manage`, `roles.manage`, `audit.view`, `crm.view`, `crm.view_all`, `crm.edit`, `crm.convert`, `catalog.view`, `catalog.edit`, `projects.view`, `projects.view_all`, `projects.manage`, `tasks.edit`, `self.attendance`, `self.leave`, `leave.approve`, `hr.view`, `hr.manage`, `hr.view_sensitive`, `attendance.view_all`, `payroll.view`, `payroll.manage`, `payroll.approve`, `payroll.post`, `self.payslip`, `self.expense`, `expenses.view`, `expenses.review`, `expenses.approve`, `expenses.post`, `budget.view`, `budget.manage`, `budget.approve`, `budget.override`, `vendors.view`, `vendors.manage`, `vendors.bills`, `vendors.post`, `assets.view`, `assets.manage`, `assets.post`, `investments.view`, `investments.manage`, `reports.view`, `dashboard.executive`, `content.view`, `content.manage`, `content.publish`, `clients.view`, `clients.edit`, `finance.view`, `finance.post`

### CEO / Director

`dashboard.view`, `settings.company.view`, `bank.view`, `users.view`, `audit.view`, `crm.view`, `crm.view_all`, `catalog.view`, `clients.view`, `finance.view`, `projects.view`, `projects.view_all`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `hr.view`, `leave.approve`, `payroll.view`, `payroll.approve`, `expenses.view`, `expenses.approve`, `budget.view`, `budget.approve`, `budget.override`, `vendors.view`, `assets.view`, `investments.view`, `reports.view`, `dashboard.executive`

### Marketing Director

`dashboard.view`, `crm.view`, `crm.view_all`, `catalog.view`, `catalog.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `content.view`, `content.manage`, `content.publish`

### Branch Manager

`dashboard.view`, `users.view`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `leave.approve`, `hr.view`

### Finance Manager

`dashboard.view`, `settings.company.view`, `bank.view`, `bank.view_full`, `bank.edit`, `clients.view`, `clients.edit`, `finance.view`, `finance.post`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `payroll.view`, `payroll.approve`, `payroll.post`, `expenses.view`, `expenses.review`, `expenses.approve`, `expenses.post`, `budget.view`, `budget.manage`, `vendors.view`, `vendors.bills`, `vendors.post`, `assets.view`, `assets.manage`, `assets.post`, `investments.view`, `investments.manage`, `reports.view`, `dashboard.executive`

### Accountant

`dashboard.view`, `bank.view`, `clients.view`, `clients.edit`, `finance.view`, `finance.post`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `expenses.view`, `expenses.review`, `expenses.post`, `budget.view`, `vendors.view`, `vendors.post`, `assets.view`, `assets.manage`, `reports.view`

### HR Manager

`dashboard.view`, `users.view`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `hr.view`, `hr.manage`, `hr.view_sensitive`, `leave.approve`, `attendance.view_all`, `payroll.view`, `payroll.manage`

### Payroll Officer

`dashboard.view`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `hr.view`, `payroll.view`, `payroll.manage`

### Sales Manager

`dashboard.view`, `crm.view`, `crm.view_all`, `crm.edit`, `crm.convert`, `catalog.view`, `clients.view`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `leave.approve`

### Sales Agent

`dashboard.view`, `crm.view`, `crm.edit`, `catalog.view`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`

### Success Manager

`dashboard.view`, `projects.view`, `tasks.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `content.view`, `content.manage`

### Project Manager

`dashboard.view`, `projects.view`, `projects.manage`, `tasks.edit`, `clients.view`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `leave.approve`, `budget.view`, `vendors.view`, `vendors.manage`, `content.view`, `content.manage`, `content.publish`

### Ads Manager

`dashboard.view`, `projects.view`, `tasks.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `content.view`

### Ads Expert

`dashboard.view`, `projects.view`, `tasks.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`

### Graphic Designer

`dashboard.view`, `projects.view`, `tasks.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `content.view`, `content.manage`

### Video Editor

`dashboard.view`, `projects.view`, `tasks.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`, `content.view`, `content.manage`

### Web Developer

`dashboard.view`, `projects.view`, `tasks.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`

### AI Engineer

`dashboard.view`, `projects.view`, `tasks.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`

### Intern

`dashboard.view`, `projects.view`, `tasks.edit`, `self.attendance`, `self.leave`, `self.payslip`, `self.expense`

### Client

No internal permissions. Uses a separate portal with data scoped to their own organization.

### Vendor

No internal permissions. Uses a separate portal with data scoped to their own organization.

### Business Partner

No internal permissions. Uses a separate portal with data scoped to their own organization.

### Investor

No internal permissions. Uses a separate portal with data scoped to their own organization.
