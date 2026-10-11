// The widgets a person can put on their dashboard, and the permission each one needs.
export type WidgetDef = { id: string; title: string; permission: string; wide: boolean };

export const WIDGETS: WidgetDef[] = [
  { id: "quest", title: "Today's goals", permission: "crm.view", wide: true },
  { id: "followups", title: "Follow-ups due", permission: "crm.view", wide: false },
  { id: "tasks", title: "My tasks", permission: "projects.view", wide: false },
  { id: "meetings", title: "Upcoming meetings", permission: "meetings.use", wide: false },
  { id: "contacts", title: "Recently added contacts", permission: "crm.view", wide: false },
  { id: "money", title: "Money this month", permission: "dashboard.executive", wide: true },
  { id: "kpis", title: "Pipeline and operations", permission: "dashboard.executive", wide: true },
  { id: "attention", title: "Needs attention", permission: "dashboard.executive", wide: true },
  { id: "org", title: "Organisation at a glance", permission: "users.view", wide: true },
];

export const availableWidgets = (permissions: ReadonlySet<string>) => WIDGETS.filter((w) => permissions.has(w.permission));
