// The cards a person can arrange on the Overview tab, and what a person needs to hold to get each one (any one of the listed permissions).
export type WidgetDef = { id: string; title: string; permissions: string[]; wide: boolean };

export const WIDGETS: WidgetDef[] = [
  { id: "followups", title: "Follow-ups due", permissions: ["crm.view"], wide: false },
  { id: "overdue", title: "Overdue invoices", permissions: ["finance.view"], wide: false },
  { id: "vouchers", title: "Vouchers awaiting approval", permissions: ["expenses.review", "expenses.approve"], wide: false },
  { id: "commissions", title: "Commissions to approve", permissions: ["commissions.approve", "commissions.manage"], wide: false },
  { id: "attendance", title: "Attendance not marked today", permissions: ["attendance.view_all"], wide: false },
  { id: "posts", title: "Posts to publish today", permissions: ["content.view"], wide: false },
  { id: "tasks", title: "My tasks", permissions: ["projects.view"], wide: false },
  { id: "meetings", title: "Upcoming meetings", permissions: ["meetings.use"], wide: false },
  { id: "contacts", title: "Recently added contacts", permissions: ["crm.view"], wide: false },
  { id: "quest", title: "Today's goals", permissions: ["crm.view"], wide: true },
];

export const availableWidgets = (permissions: ReadonlySet<string>) => WIDGETS.filter((w) => w.permissions.some((p) => permissions.has(p)));
