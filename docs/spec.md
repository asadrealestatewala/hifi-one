## 1. Your role and mission

You are acting as a principal software architect, senior full-stack engineer, ERP consultant, accounting systems designer, UI/UX designer, QA engineer, and AI integration specialist.

Build a production-oriented, modular, interconnected enterprise resource planning platform for Hifi Marketing and Technologies, a company delivering digital marketing, creative production, software development, AI solutions, SaaS products, lead generation, BPO, and related services.

The platform must provide a unified workspace for company leadership, super administrators, finance managers, HR, branch managers, sales agents, sales managers, marketing directors, project managers, success managers, designers, video editors, developers, advertising specialists, interns, clients, vendors, and business partners.

The platform must be modern, responsive, secure, scalable, auditable, and easy for nontechnical staff to use.

### Mandatory development rules

1. Inspect the existing repository, framework, database, authentication system, components, routes, APIs, and integrations before modifying anything.
2. Preserve all working functionality. Do not replace the application with a fresh scaffold unless explicitly necessary and approved.
3. Reuse existing components and conventions wherever appropriate.
4. Build real functionality, not static dashboard mockups, dead buttons, placeholder tables, or simulated integrations presented as working features.
5. Every module must use the same underlying entities and authoritative data.
6. Every financial transaction must be traceable, and all financial changes must have an audit trail.
7. All forms must have validation, clear success/error states, loading states, and appropriate permission checks.
8. All dashboards, reports, cards, charts, ledgers, notifications, and downloadable documents must use actual persisted data.
9. Implement in phases, keeping the application runnable and testable after each phase.
10. Do not expose API keys, secrets, payroll details, client financial data, employee screenshots, or private documents to unauthorized users.
11. When a third-party service requires credentials, implement the integration interface, secure configuration, test mode, and setup instructions. Never falsely report an unconfigured integration as connected.
12. Do not delete production data or run destructive database migrations without explicit authorization.

## 2. Product vision and interface design

Create a unified enterprise application called Hifi One, with Hifi Marketing and Technologies as the default organization.

The application should feel like a premium combination of a modern CRM, ERP, project management platform, financial management system, and employee operating system.

Use the supplied screenshots as design references for the pricing page and service-plan cards.

[AI Analytics Dashboard UI/UX Design by Rixlab on Dribbble](https://images.openai.com/static-rsc-4/Oq54tBACy1L6kvWN7UoK0puGAZIa470Dt3e38yB7tuN-tWtnMoTSnT49zOxyHG1hYcwABXcHZsUBLuT5xaKL2x3mu7kpsy54vUbtsytxJrFZFVvI_SuBKY17XOsGnxuSlvPv5FLZvAkRug16H764fa5OroCojxK31C6StfGF6ts?purpose=inline)

Application interface

Clean navigation, dashboards, searchable tables, profile avatars, and clear financial summaries.

[Pricing Section designs, themes, templates and downloadable graphic elements on Dribbble](https://images.openai.com/static-rsc-4/BfYTuxWSvWujKVHo9dHgSI-G3xvZP5b8C94_F-HjyM0bgDAxuITnQkxAo7XhLrvTgCKOzgMg4ZcqUwC5EncOseTIe6JURiJIIrfJU1UBKHywXghcP-GBIvnzF6lXesuTYI7tAy9FZsk8y92ZfGC6hdYPnS2BdzMh86phgpH0kjk?purpose=inline)

Pricing and service plans

Three-tier plan cards, a highlighted popular plan, included features, and prominent booking actions.

### Visual identity

- Primary colors: Hifi blue/purple, dark navy, white, light gray, and restrained silver accents.
- Use clean typography, generous spacing, subtle shadows, rounded cards, and consistent icons.
- Support both light and dark themes.
- Use employee and client profile photographs wherever appropriate and authorized.
- Build a collapsible left sidebar with grouped modules and role-specific navigation.
- Use a top bar for global search, notifications, quick actions, meetings, profile settings, and organization/branch selection.
- Provide responsive desktop, tablet, and mobile layouts.
- Use tables with search, filtering, sorting, pagination, column controls, and export actions.
- Use kanban boards with drag-and-drop, calendars, timelines, and Gantt-style project views where appropriate.
- Provide empty states, onboarding prompts, loading skeletons, and accessible form controls.

Avoid cramming every feature onto the home screen. Give each role a dashboard containing the metrics and actions relevant to their responsibilities.

## 3. System architecture

First determine the existing technology stack. Follow it if it is sound. If the project is incomplete or no stack has been established, use a maintainable TypeScript-first architecture.

Preferred architecture where a greenfield implementation is needed:

- Frontend: Next.js, React, TypeScript.
- UI: Tailwind CSS and a reusable accessible component system.
- Database: PostgreSQL.
- ORM and migrations: Prisma or the repository's established equivalent.
- Authentication: secure session-based authentication or an established authentication provider.
- Backend: typed API routes or a separately structured service layer.
- Background jobs: a durable queue for notifications, report generation, scheduled jobs, and integrations.
- File storage: private object storage with signed, time-limited downloads.
- Realtime features: WebSockets or an equivalent reliable realtime service.
- Charts: a maintained charting library.
- Automated tests: unit, integration, API, permission, and end-to-end tests.

Do not introduce a new framework simply because it is listed here.

### Architecture requirements

Organize the platform into clear functional domains:

- Identity, organization, branches, and access control.
- CRM and sales.
- Clients, subscriptions, service plans, and billing.
- Projects, tasks, resources, and deliverables.
- Content production and marketing campaign reporting.
- HRM, attendance, leave, payroll, and incentives.
- Accounting, banking, invoicing, budgeting, and assets.
- Vendor procurement, outsourcing, and payables.
- Investments, partnerships, and joint ventures.
- Client portal and vendor portal.
- Meetings, messaging, and notifications.
- Employee productivity and activity tracking.
- AI assistant, reporting, and integrations.

Use a modular monolith initially unless the existing project or scale requires otherwise. Separate domain services and integration adapters so that modules can evolve independently.

Create a clear separation between UI, business logic, data access, integration services, and authorization.

## 4. Role-based access control and portals

Implement permission-based access control, not merely hidden navigation items.

### Initial roles

Executive and administration

Super Admin, CEO/Director, Marketing Director, Branch Manager

Finance and human resources

Finance Manager, Accountant, HR Manager, Payroll Officer

Sales and client success

Sales Agent, Sales Manager, Success Manager

Project delivery

Project Manager, Ads Manager, Ads Expert, Graphic Designer, Video Editor, Web Developer, AI Engineer, Intern

External stakeholders

Client, Vendor, Business Partner, Investor

Allow custom roles, custom permission sets, department membership, branch assignment, reporting hierarchy, and temporary access delegation.

Implement granular permissions for viewing, creating, editing, approving, deleting, exporting, and downloading information.

For example:

- Sales agents may access their assigned leads, authorized client records, own performance, and personal payroll information.
- Sales managers may access team pipelines and approved team performance reports.
- Project managers may access their assigned projects, budgets, deliverables, team assignments, and authorized client communications.
- Finance managers may access ledgers, invoices, receipts, accounts, budgets, expenses, payroll-related financial records, and financial reports according to their permissions.
- HR may access employee records, attendance, leave, documents, and authorized payroll workflows.
- Clients may only access their own organization, contracted services, approved project data, invoices, payments, content approvals, and reports.
- Vendors may only access their own contracts, assigned work, approved vouchers, balances, and payments.
- Partners and investors must have separately controlled access to their own agreements, financial statements, and relevant documents.

Super Admin access must be logged. Sensitive records should be protected even from users who can access other parts of the system.

## 5. Global application navigation

Create a configurable sidebar containing the following modules.

Overview

Executive Dashboard, Notifications, Global Search, Calendar

CRM & Sales

Leads, Opportunities, Contacts, Companies, Smart Lists, Campaigns, Sales Activities, Proposals, Sales Targets

Services & Clients

Service Catalog, Pricing Plans, Client Accounts, Subscriptions, Contracts, Invoices, Receipts, Client Portal

Project Operations

Projects, Tasks, Teams, Deliverables, Content Calendar, Approvals, Meetings, Project Reviews

Finance & Accounting

Chart of Accounts, General Ledger, Accounts Receivable, Accounts Payable, Expenses, Budgets, Bank Reconciliation, Payroll Journal, Assets, Investments, JV Accounts

People & HR

Employees, Attendance, Timesheets, Leave, Shifts, Payroll, Bonuses, Incentives, Recruitment, Documents

Procurement & Vendors

Vendor Directory, Outsourcing Opportunities, Contracts, Purchase Orders, Bills, Vendor Ledgers, Vouchers

Communication & AI

Internal Chat, WhatsApp, Email, AI Assistant, Meeting Center, Notifications

Analytics & Administration

Reports, Audit Logs, Integrations, Organization Settings, Roles, Permissions, Custom Fields

Render menu items according to permissions. Support pinned favorites, recent records, quick-create actions, and configurable dashboard widgets.

## 6. Complete CRM and sales management

Build a CRM that manages the entire journey from prospect acquisition to customer conversion, invoicing, project delivery, renewal, and upselling.

### Lead management

Every lead should support:

- Unique lead ID.
- Name, company, email, phone, country, city, timezone, and preferred contact method.
- Source: cold calling, Facebook, Instagram, LinkedIn, referrals, website forms, email campaigns, advertising, imported lists, and other configurable sources.
- Assigned sales agent, sales manager, campaign, and branch.
- Service interest, expected deal value, currency, probability, expected closing date, and priority.
- Lead status, next follow-up, last contact, notes, tags, and custom fields.
- Call logs, email history, WhatsApp history when integrated, tasks, appointments, proposals, attachments, and full activity timeline.
- Duplicate detection based on email, phone, and configurable matching rules.
- Lead scoring and AI-assisted qualification.

Support these statuses:

- New.
- Interested.
- Follow-up.
- Proposal Sent.
- Negotiation.
- Not Interested.
- Closed Won.
- Closed Lost.
- Nurture / Future Opportunity.

Make statuses and pipeline stages configurable.

### Opportunity pipeline

Create a drag-and-drop opportunity board similar to modern CRM kanban boards.

Each opportunity card should display:

- Contact and company.
- Sales agent avatar.
- Deal value and currency.
- Campaign and requested service.
- Current stage and probability.
- Next follow-up date.
- Days in the current stage.
- Outstanding actions.

Allow managers to set stage-specific requirements, reminders, probability values, and approval rules.

Moving an opportunity to Closed Won must trigger a controlled conversion workflow rather than merely changing a label.

### Client conversion automation

When a lead becomes a customer:

1. Convert or link the existing contact to a client organization.
2. Preserve the lead's activity history.
3. Create a customer account without duplicating contact data.
4. Allow selection of one or multiple services and customized plans.
5. Record the deal value, billing currency, contract dates, billing frequency, payment terms, and discounts.
6. Record sales agent and manager assignments.
7. Configure sales commission, rebate, and project success incentive rules.
8. Generate a proposal or contract when required.
9. Create the initial invoice or pro forma invoice according to company policy and the selected billing workflow.
10. Generate the customer ledger and accounts receivable entry when an actual invoice is posted.
11. Create the project and delivery tasks automatically when required by the selected service plan.
12. Invite the customer to the client portal.
13. Send the invoice or onboarding message through an authorized communication channel.
14. Create notifications and an auditable conversion record.

Make these operations transactional where possible and idempotent so retries cannot create duplicate customers, invoices, or projects.

Do not recognize revenue merely because a lead becomes a customer. Revenue recognition must follow the configured accounting policy and applicable accounting rules.

### Smart Lists

Build dynamic and saved Smart Lists with user-defined filters, such as:

- Leads requiring follow-up today.
- Interested prospects with no recent contact.
- Proposals awaiting a decision.
- Leads inactive for seven days.
- Leads assigned to a particular agent.
- Leads from a particular campaign or source.
- Customers due for renewal.
- Clients with overdue invoices.
- Upsell opportunities.
- Imported prospecting records that have not yet been qualified.

Allow list owners to save, share, schedule, export, and reuse filters subject to access permissions.

### Sales activities

Track calls, connected calls, emails, meetings, follow-ups, proposals, lead additions, appointments, and conversions.

Set daily and monthly targets per agent, including configurable targets such as 80 connected calls per day.

Distinguish attempted calls from connected calls. Only count connected calls when a verified call result or authorized telephony integration supports that classification.

Create a daily activity dashboard with target-versus-actual charts, overdue follow-ups, conversion rates, pipeline value, and team rankings.

## 7. Prospecting and campaign worklists

Some imported lead sheets contain low-intent or unqualified records that are intended only to document prospecting work and should not clutter the main CRM.

Build two distinct workflows.

A. CRM leads: Qualified or potentially valuable prospects that belong to the sales pipeline.

B. Prospecting worklists: Raw lead sheets, scraped business directories where legally permitted, research lists, and unqualified outreach records.

For prospecting worklists, implement:

- CSV/XLSX import with field mapping and preview.
- Campaign or worklist name, source, import date, assigned employee, and target completion date.
- Original row ID and source file reference.
- Contact attempt, disposition, notes, and completion status.
- Optional conversion into a real CRM lead.
- Duplicate detection against existing CRM records.
- Invalid record and import error reports.
- Import history and export.
- Suppression and do-not-contact checks.
- Appropriate privacy and outreach compliance rules.

Do not automatically create a full customer record for every imported row. Do not allow unqualified records to inflate the CRM's lead conversion metrics.

Create separate productivity metrics for raw records processed and genuine CRM leads generated.

## 8. AI sales assistant and campaign copilot

Build an AI assistant that can help employees understand campaigns, prepare sales scripts, handle objections, summarize conversations, and navigate the ERP.

The assistant should support:

- Selecting an active sales campaign.
- Retrieving the correct approved campaign script.
- Opening relevant lead or contact context based on permissions.
- Suggesting an introduction, qualification questions, objection handling, and closing questions.
- Generating follow-up emails and WhatsApp templates.
- Summarizing previous interactions.
- Explaining campaign goals and required KPIs.
- Answering questions about internal SOPs, services, pricing, and product documentation.
- Recommending the next best action.
- Showing personal performance against daily targets.
- Helping users find records and reports they are authorized to access.

Provide a campaign knowledge base with approved scripts, service information, FAQs, objection responses, prohibited claims, and campaign-specific instructions.

Require authorized human approval for changes to official pricing, published scripts, contractual commitments, and financial transactions.

Never let the AI independently approve payments, change payroll, expose restricted records, or bypass permissions.

## 9. Service catalog and customized pricing plans

This module is critical. Hifi sells both predefined service packages and custom enterprise engagements.

Build a dynamic service catalog with a configurable pricing engine, rather than hardcoding plans into the frontend.

### Service categories

Include:

1. Digital Marketing.
2. Social Media Management.
3. Video Editing and Video Production.
4. Graphic Design and Creative Services.
5. Website Design and Development.
6. Software Development.
7. AI Bots, AI Agents, and AI Software Solutions.
8. SaaS Products and Subscriptions.
9. SEO Services.
10. Email Marketing.
11. Cold Calling and Telemarketing.
12. Lead Generation and Prospecting.
13. Meta Ads Management.
14. TikTok Ads Management.
15. YouTube Ads Management.
16. Google Ads and PPC Campaigns.
17. Marketing Automation and CRM Setup.
18. Website Maintenance and Management.
19. CGI, 3D, and Animation.
20. Custom Projects and Other Services.

Allow administrators to add new categories and subcategories.

### Pricing page design

Recreate the pricing-card pattern shown in the supplied Hifi screenshots:

- Category selector across the top.
- Three or more configurable plans.
- Starter, Pro, Enterprise, or custom plan names.
- A highlighted “Most Popular” plan.
- Icon, plan name, billing interval, price, and currency.
- List of included features with clear status indicators.
- Prominent “Book Now” or “Get Started” button.
- Custom quotation option.
- Responsive layout.
- Public pricing page and internal sales quotation view.

Use the following values as editable seed data inspired by the screenshots, not as permanent or universal prices.

| Service / Plan    | Illustrative price |
| ----------------- | ------------------ |
| Social Starter    | AED 799/month      |
| Social Pro        | AED 1,499/month    |
| Social Enterprise | AED 2,999/month    |
| ERP Basic         | AED 499/month      |
| ERP Pro           | AED 999/month      |
| ERP Enterprise    | AED 2,999/month    |

Sample Social Starter features: 3 social platforms, 10 posts per month, basic analytics, monthly report.

Sample Social Pro features: all supported social platforms, 20 posts plus stories, paid ad management, advanced analytics, content strategy, weekly reports.

Sample Social Enterprise features: full marketing suite, configurable/unlimited content subject to contract, full ad management, influencer marketing, dedicated account manager, real-time analytics.

Sample ERP Basic features: lead management, contact database, email tracking, basic reports.

Sample ERP Pro features: full CRM features, sales pipeline, email automation, advanced analytics, tool integration, 5 user accounts.

Sample ERP Enterprise features: complete ERP solution, inventory management, HR and payroll, financial management, custom modules, unlimited users subject to agreement.

### Advanced plan configuration

Each plan must support:

- Unique plan ID and version.
- Service category and description.
- Public or private visibility.
- Billing currency.
- One-time, monthly, quarterly, annual, hourly, milestone, or custom billing.
- Plan price and optional setup fee.
- Included deliverables and service quantities.
- Additional units and overage pricing.
- Number of accounts, platforms, seats, or users.
- Revisions, turnaround times, support levels, and service-level agreements.
- Advertising management fees versus advertising media spend.
- Taxes and applicable tax rules.
- Discount and promotional rules.
- Contract duration, minimum commitment, and renewal terms.
- Optional add-ons.
- Approval requirements and custom quotation overrides.
- Internal cost estimate and expected gross margin, visible only to authorized roles.

Allow sales staff to combine multiple services into one deal, add custom deliverables, and prepare customer-specific packages.

Never assume that every customer pays the public list price. The approved customer contract, quotation, and order must preserve the exact agreed commercial terms.

### Multi-currency requirements

Support PKR, USD, AED, and GBP throughout the platform.

- Store transaction currency and amount.
- Store the applicable exchange rate, rate date, and base currency equivalent when required.
- Maintain historical exchange rates without rewriting old transactions.
- Configure the organization's functional/base currency.
- Support per-currency price books and regional pricing.
- Allow the same plan to have different PKR, USD, AED, and GBP prices.
- Distinguish transaction currency from reporting currency.
- Support currency conversion gains/losses where applicable.
- Keep rounding rules consistent in invoices, receipts, ledgers, and reports.

Do not simply change the currency symbol while keeping the same numeric price. Maintain independent regional prices or apply an explicitly configured conversion policy.

## 10. Client account management and client portal

Build a dedicated, branded portal for each client.

The portal must display the client's actual contracted services, assigned projects, deliverables, invoices, receipts, payments, content calendar, marketing reports, communications, and support requests.

### Client dashboard

Show:

- Active and completed projects.
- Project completion and milestone status.
- Upcoming deliverables and approvals.
- Outstanding and paid invoices.
- Payments and account balance.
- Service subscriptions and renewal dates.
- Monthly campaign performance.
- Pending client actions.
- Announcements and offers.
- Recent project updates.
- Upcoming meetings and support requests.

### Client profile

Maintain:

- Company and billing information.
- Authorized contacts.
- Contract documents and service agreements.
- Tax information where applicable.
- Selected services and pricing plan versions.
- Payment terms.
- Project and communication history.
- Authorized portal users.
- Internal-only notes, separate from client-visible notes.

### Client ledger

Provide a transaction-by-transaction account statement containing:

- Date.
- Document number.
- Description.
- Invoice debit.
- Payment or credit.
- Tax, discounts, and adjustments.
- Running balance.
- Currency.
- Related service, project, or contract.

Allow clients to download PDF statements and authorized invoices/receipts. Export CSV only where enabled.

The client must never see internal commission costs, other customers, internal profit margins, employee payroll, confidential vendor prices, or internal project commentary.

### Announcements and offers

Provide a backend-managed announcement system for:

- New service offers.
- Promotional packages.
- SaaS product launches.
- Free trials and giveaways.
- Renewal offers.
- Upselling and cross-selling.
- Company news and service updates.

Support targeted announcements by client segment, service category, region, subscription status, or custom Smart List.

Include start/end dates, visibility settings, call-to-action links, and delivery/read tracking.

### Client project tracking

Display a clear project timeline and deliverable pipeline inspired by Primavera-style scheduling but simplified for clients.

Show:

- Project phase.
- Milestone and target date.
- Current status.
- Assigned department or public-facing team member.
- Dependencies where appropriate.
- Progress percentage.
- Pending approvals.
- Actual versus planned delivery dates.
- Client-visible comments and attachments.

Internal discussions, private estimates, sensitive employee monitoring data, and restricted task details must remain internal.

## 11. Content calendar and approval workflow

Build a content calendar for social media and marketing clients.

Support:

- Calendar, list, and board views.
- Platforms such as Facebook, Instagram, TikTok, LinkedIn, and YouTube.
- Post copy, hashtags, creative assets, video files, campaign, planned date, and publishing status.
- Version history and revision requests.
- Assigned designer, editor, copywriter, and approver.
- Client comments and feedback.
- Approval, rejection, and request-changes actions.
- Approval timestamps and user identity.
- Internal review before client submission.
- Notifications for upcoming deadlines and overdue approvals.

Each item should progress through configurable states such as:

Draft → Internal Review → Client Review → Changes Requested → Approved → Scheduled → Published.

Only mark content as published after an authorized user or verified platform integration confirms publication.

Client approvals must be attributable to an authorized client user. A rejection must require or strongly encourage a reason, and all changes must be recorded in the activity history.

## 12. Project management and delivery operations

Build a full project management system inspired by the useful workflows of Flowlu and Bordio, with improved integration into Hifi's CRM, HRM, finance, and client portal.

### Project creation

Projects can originate from:

- Closed-won CRM deals.
- Client service subscriptions.
- Manually approved internal projects.
- SaaS development initiatives.
- Outsourcing and vendor contracts.
- Internal company operations.

Each project should inherit relevant client, contract, currency, approved scope, deliverables, milestones, budget, and incentive rules.

### Project record

Include:

- Project ID and name.
- Client.
- Service category.
- Project manager.
- Team members and department.
- Start date, deadline, and priority.
- Contract value and currency.
- Approved project budget.
- Internal labor cost and vendor cost estimates.
- Actual expenses and cost commitments.
- Scope, deliverables, and acceptance criteria.
- Milestones and dependencies.
- Risk register and issues.
- Files, discussions, and meeting history.
- Client-visible updates.
- Profitability and delivery metrics.

### Task management

Allow task assignment to one or more employees with:

- Title, description, task type, priority, and status.
- Project, milestone, and parent task.
- Assignee and collaborators.
- Start date, deadline, and estimated hours.
- Actual work log and completion evidence.
- Checklist and subtasks.
- Attachments and comments.
- Dependencies and blocked status.
- Internal/client-visible visibility.
- Review and approval requirements.
- Notifications and escalation rules.

Include drag-and-drop task boards, calendar view, Gantt/timeline view, workload view, and employee task lists.

Show employee profile photographs beside assignments to make ownership visible.

### Team selection

When creating a project, allow the project manager to select the relevant team:

- Graphic designer.
- Video editor.
- Copywriter.
- Web developer.
- Software developer.
- AI engineer.
- Ads expert.
- Ads manager.
- SEO specialist.
- Social media manager.
- Intern.
- External vendor.

Support reusable team templates by service category.

### Project manager workspace

The project manager should be able to:

- Assign tasks and select team members.
- Review daily progress.
- Identify overdue or blocked tasks.
- Approve work before client submission.
- Manage client updates.
- Control milestone delivery.
- Monitor estimated and actual project cost.
- Request vendor work.
- Escalate resource conflicts.
- Schedule internal and client meetings.
- Generate project status reports.
- Trigger client notifications.
- Request a success review.

Task completion must update project progress according to a consistent rule. Do not allow manually changing a project to 100% complete when mandatory deliverables or approvals remain incomplete.

### Resource and budget allocation

Support project-level resource planning and cost substitution.

For example, if a project initially allocates PKR 100,000 to external development and the approved approach changes to internal development, finance must be able to record the budget reallocation with:

- Original allocation.
- Revised allocation.
- Reason.
- Approver.
- Date.
- Related project and accounts.
- Actual costs already incurred.
- Remaining available budget.

Reallocation must not delete or rewrite historical expenses. Preserve the audit trail and prevent overspending beyond configured limits without authorization.

## 13. Employee chat, collaboration, and notifications

Provide project-specific discussion channels, task comments, direct messages, and team conversations.

Features should include:

- Real-time chat where supported.
- Text and file attachments.
- Mentions and replies.
- Read status where appropriate.
- Searchable message history.
- Links to tasks, projects, clients, and meetings.
- Notification preferences.
- Internal versus client-visible messages.
- Access controls and retention policies.

Build a centralized notification service supporting in-app notifications and browser push notifications where permitted.

Notifications should cover:

- New tasks and assignments.
- Due dates and overdue work.
- Mentions and replies.
- Client approvals and revision requests.
- Lead follow-ups.
- Proposal status changes.
- Invoice creation and payment confirmation.
- Leave requests and approvals.
- Payroll publication.
- Meetings and schedule changes.
- Project milestone changes.
- Vendor contract opportunities.
- Low budgets and pending financial approvals.
- Security-related account events.

Provide read/unread states, configurable preferences, notification grouping, and deep links to the relevant record.

## 14. Meeting and video collaboration platform

Build a Meeting Center integrated into projects, tasks, employee calendars, and client accounts.

Required user experience:

- Create and schedule meetings.
- Generate meeting invitations and secure join links.
- Internal, client, and vendor meetings.
- Participant lists and role permissions.
- Camera and microphone controls.
- Screen sharing.
- Meeting chat.
- Captions and transcripts.
- Recording where explicitly enabled.
- Meeting notes, action items, and task creation.
- Meeting attendance and duration.
- Calendar integration where configured.
- Post-meeting summaries and follow-up tasks.

Support remote screen sharing for project reviews and client demonstrations.

### Implementation strategy

Do not attempt to recreate an entire browser-based conferencing infrastructure from scratch if a reliable existing provider can meet the requirements.

Create a meeting-provider abstraction that can integrate with a suitable conferencing SDK or service, including a self-hosted option if justified.

Evaluate WebRTC-based technologies and established providers. Document licensing, infrastructure, recording storage, and operational requirements.

For remote device access resembling AnyDesk, integrate an established remote support solution where appropriate. Require explicit consent from the remote user, clear session indicators, authentication, permission prompts, and immediate termination controls. Remote control must never be silently enabled.

Recording and transcript generation must have participant disclosure, authorization, appropriate retention, and access logging. Do not claim that video recording, screen sharing, captions, or remote control works until the integration has been configured and tested.

## 15. HRM and complete employee management

Build a comprehensive HR management module.

### Employee profile

Include:

- Employee ID.
- Profile picture.
- Full name.
- Father/guardian name where required for HR records.
- Date of birth.
- Contact number and personal email.
- Official email.
- Address.
- Emergency contact.
- CNIC or other relevant identity document.
- Department, designation, branch, and manager.
- Employment type.
- Work location: office, remote, hybrid, or field.
- Date of joining.
- Probation and confirmation dates.
- Contract and employment status.
- Salary structure and payroll currency.
- Bank or payment details, with restricted access.
- Qualifications and skills.
- Uploaded documents and expiry dates.
- Performance reviews and disciplinary records where authorized.
- Assigned equipment and company assets.
- Exit date and offboarding checklist.

Keep identity documents, banking details, medical information if collected, and other sensitive data restricted to authorized HR users.

### Attendance and shifts

Support:

- Clock in.
- Clock out.
- Break start/end.
- Shift scheduling.
- Grace periods and lateness rules.
- Attendance corrections.
- Missing-punch requests.
- Overtime requests and approvals.
- Office and remote attendance.
- Timesheets linked to projects where appropriate.
- Attendance reports and export.

Define how overnight shifts, public holidays, weekends, timezones, and daylight-saving changes are handled.

For remote workers, do not assume a user is working solely because their session is open. Clearly distinguish attendance time, active work time, and manually reported work.

### Leave management

Create configurable leave types, such as annual, casual, sick, unpaid, and other organization-defined leave categories.

Allow employees to:

- View leave balances.
- Submit leave applications.
- Select dates and provide a reason.
- Attach supporting documents when appropriate.
- Track approval/rejection status.
- Cancel eligible requests.
- View team calendars subject to permissions.

Support configurable approval chains, delegation, overlapping-leave validation, and balance calculation.

### Employee portal

Every employee should have a personalized dashboard displaying:

- Today's schedule.
- Attendance and break controls.
- Assigned tasks.
- Pending tasks and deadlines.
- Personal calendar and meetings.
- Leave balances and applications.
- Payroll slips.
- Bonuses and incentives.
- Sales targets where relevant.
- Performance achievements.
- Announcements.
- Training materials.
- Notifications.
- Personal profile and permitted document uploads.

## 16. Payroll, bonuses, and sales incentives

Build a payroll module with a configurable compensation structure.

Support:

- Basic salary.
- Allowances.
- Overtime.
- Attendance adjustments.
- Approved deductions.
- Commission.
- Bonuses and incentives.
- Advances and loans where applicable.
- Employer contributions where applicable.
- Tax and statutory deductions according to configured jurisdiction and policy.
- Net payable.
- Payroll approval and payment status.
- Employee payslip PDF.
- Payroll register and accounting journal.

Support PKR, USD, AED, and GBP payroll where authorized, with explicit exchange-rate handling for consolidated reports.

Payroll should run through a controlled approval workflow. Approved payroll periods should be locked against ordinary edits; corrections should use auditable adjustment entries.

### Sales commission engine

Support commissions based on:

- Fixed amount per closed sale.
- Percentage of eligible deal value.
- Percentage of cash actually collected.
- Product or service category.
- Sales campaign.
- Agent or manager.
- Revenue tier or target achievement.
- Custom contractual formula.

Show each agent their eligible, pending, approved, paid, reversed, and forfeited commission.

Prevent duplicate commissions when an invoice is edited, a payment is retried, or a CRM event is processed more than once.

### Sales rebate and manager override

Allow sales managers to receive an approved percentage or fixed bonus linked to team sales, subject to configured rules.

Store the commission formula and percentage snapshot against each eligible deal when the transaction is approved.

When payments are received in installments, calculate commission based on the selected commission policy: booking, invoice, or actual collection.

Support clawbacks or adjustments for refunds and cancelled deals only according to an explicitly configured policy.

## 17. Sales gamification and achievement portal

Create a motivating achievement system with:

- Daily and monthly targets.
- Connected calls.
- Qualified leads.
- Appointments booked.
- Proposals sent.
- Deals closed.
- Revenue collected.
- Conversion rate.
- Follow-up completion.
- Client retention and quality measures.

Provide achievement levels such as:

- Beginner.
- Pro.
- Closer.
- Champion.

Allow management to configure thresholds, points, badges, streaks, rewards, and recognition.

Display leaderboards within authorized teams. Let employees see their own metrics and relevant team rankings.

Do not award points for fabricated activity, duplicate leads, invalid calls, or reversed transactions. Define fair rules for leave days, part-time employees, and different campaigns.

## 18. Finance and accounting management

Build a real accounting subsystem, not merely an income/expense tracker.

It must support a chart of accounts, double-entry accounting, journal entries, receivables, payables, cash and bank accounts, customer/vendor ledgers, project budgets, tax handling, asset accounting, investments, and financial statements.

### Chart of accounts

Create an editable chart of accounts with categories such as:

- Assets.
- Liabilities.
- Equity.
- Revenue.
- Direct costs.
- Operating expenses.
- Other income.
- Other expenses.

Provide suitable subaccounts for:

- Cash and bank accounts.
- Accounts receivable.
- Accounts payable.
- Prepayments and accrued expenses.
- Deferred revenue where applicable.
- Service revenue.
- SaaS revenue.
- Advertising management revenue.
- Direct labor and contractor costs.
- Software and hosting expenses.
- Marketing expenses.
- Rent and utilities.
- Salaries and commissions.
- Taxes.
- Furniture and equipment.
- Depreciation.
- Investments.
- Partnership and joint-venture balances.
- Investment income and profit distributions.

Make the chart configurable rather than hardcoding a single jurisdiction's accounts.

### Double-entry accounting rules

Every posted accounting transaction must balance:

Total debits = total credits.

Support draft, pending approval, posted, reversed, and voided states where appropriate.

Posted journal entries must not be silently edited or deleted. Corrections should use controlled reversal and replacement entries.

Use database transactions for financial posting and ensure idempotency.

Maintain a unique document number and reference for every posted financial transaction.

### General ledger and subledgers

Provide:

- General ledger.
- Trial balance.
- Balance sheet.
- Profit and loss statement.
- Cash flow report.
- Accounts receivable aging.
- Accounts payable aging.
- Customer statements.
- Vendor statements.
- Bank and cash registers.
- Journal entry register.
- Tax summaries.
- Project profitability.
- Departmental expenses.
- Budget versus actual.
- Commission and payroll liability reports.

Every subledger must reconcile with the relevant general ledger control accounts.

### Customer accounting

When an invoice is posted, generate the appropriate receivable and revenue/tax entries according to the configured accounting policy.

When a payment is received, record the payment and apply it to the appropriate invoice(s).

Support:

- Full and partial payments.
- Multiple invoices per payment.
- Payment allocations.
- Credit notes.
- Refunds.
- Customer advances.
- Unallocated receipts.
- Discounts and adjustments.
- Write-offs with approval.
- Multi-currency settlement.
- Customer statement generation.

A payment must never be counted twice as both new revenue and settlement of an existing receivable.

### Project budget accounting

Each project should have an approved budget and configurable cost categories.

Track:

- Contracted project value.
- Invoiced value.
- Cash collected.
- Budget allocations.
- Approved purchase commitments.
- Vendor invoices.
- Internal labor costs.
- Allocated operating costs.
- Commission and incentive liabilities.
- Actual expenses.
- Remaining budget.
- Gross margin and project profitability.

Distinguish budget commitments, incurred costs, posted accounting expenses, and cash payments. Do not treat them as interchangeable.

### Investment income

Allow authorized users to register company investments across multiple industries.

Each investment record should include:

- Investment name and category.
- Investee entity.
- Initial capital invested.
- Investment date.
- Ownership percentage where applicable.
- Agreement and supporting documents.
- Expected return.
- Monthly income entries.
- Actual cash receipts.
- Outstanding amounts.
- Profit distribution.
- Fees and expenses.
- Realized/unrealized status where applicable.
- Currency and valuation method.

Separate recognized investment income from cash actually received. Configure accounting treatment according to the nature of each investment and applicable accounting policy.

## 19. Invoice, receipt, and expense voucher system

Create a dedicated document generation engine shared across CRM, accounting, client portal, vendor portal, and reporting.

Company identity for document templates:

Company Name: Hifi Marketing and Technologies

The remaining company details have not yet been supplied. Make them configurable in Company Settings rather than inventing registration, tax, bank, telephone, or address information.

### Invoice generation

Support:

- Unique invoice number.
- Invoice date and due date.
- Client name and billing details.
- Client ID and relevant contact.
- Related project, service, plan, contract, and deal.
- Itemized services and quantities.
- Unit prices and discounts.
- Tax rate, tax amount, and tax-inclusive/exclusive setting.
- Transaction currency.
- Total payable.
- Amount paid.
- Outstanding balance.
- Payment instructions.
- Terms and conditions.
- Notes and attachments.
- Authorized signature and branding.

Invoice statuses: Draft, Pending Approval, Issued, Partially Paid, Paid, Overdue, Cancelled, and Credited, as appropriate.

### Receipt generation

Support:

- Unique receipt number.
- Payment date.
- Customer and invoice references.
- Payment method.
- Transaction reference.
- Amount received.
- Currency.
- Invoice allocation.
- Unallocated balance if applicable.
- Received-by user.
- PDF download and authorized delivery.

Receipts should be generated from verified payment records, not simply by marking an invoice as paid.

### Expense vouchers

Support:

- Unique voucher number.
- Voucher date.
- Payee/vendor/employee/partner.
- Expense category and account code.
- Branch, department, project, and cost center.
- Description and business justification.
- Gross amount, tax, and currency.
- Payment method.
- Supporting receipts and documents.
- Prepared by, reviewed by, approved by, and paid by.
- Payment reference and accounting status.

Provide separate workflows for cash vouchers, bank payments, vendor bills, employee reimbursements, and journal-only adjustments.

### PDF and document engine

Generate professional PDFs for invoices, receipts, statements, payslips, expense vouchers, quotations, contracts, and reports.

Support company logo, document templates, regional number/date formats, and multi-currency formatting.

Documents must be downloadable from authorized record screens and sent through approved communication integrations.

Never create a payment receipt before confirming that the underlying payment was recorded successfully.

## 20. Expense management, approvals, and budget substitution

Create an expense management workspace for the finance team and authorized department managers.

Support expenses categorized by:

- Department.
- Branch.
- Project.
- Employee.
- Vendor.
- Marketing campaign.
- Software subscription.
- Office operations.
- Asset purchase.
- Investment.
- Partnership or joint venture.
- Outsourcing.
- Other configurable categories.

Implement a configurable approval workflow:

Submitted → Under Review → Approved → Posted → Paid.

Allow rejection, returned-for-correction, cancellation, and reversal workflows with recorded reasons.

### Budget controls

- Define annual, quarterly, monthly, departmental, and project budgets.
- Allocate budgets across projects and expense categories.
- Compare approved budget, committed spend, posted expenditure, and remaining budget.
- Configure warning thresholds, such as 75%, 90%, and 100%.
- Prevent unauthorized overspending.
- Require additional approval for budget transfers.
- Record the original and revised budget allocations.
- Show the impact of budget changes on project profitability.
- Notify project managers and finance when limits are approached.

An expense voucher must reference its project, cost center, and account where applicable. Avoid double-counting expenses when an approved voucher later becomes a posted journal entry.

## 21. Vendor management and outsourcing marketplace

Build a dedicated vendor portal connected to project management, procurement, accounts payable, and announcements.

### Vendor profiles

Include:

- Vendor ID and legal/business name.
- Contact details and address.
- Country and preferred currency.
- Service categories and skills.
- Company registration and tax details where applicable.
- Contracts, agreements, and compliance documents.
- Payment terms and bank/payment details with restricted access.
- Vendor rating and performance history.
- Assigned projects and work orders.
- Bills, invoices, vouchers, and payment ledger.
- Internal notes and approval status.

### Vendor opportunity announcements

Super Admin, procurement staff, or authorized project managers should be able to publish opportunities such as:

- Outsourced software development.
- Website development.
- AI automation projects.
- Video editing and graphic design.
- Social media production.
- Marketing campaign execution.
- Lead generation.
- Contract staffing.
- Recruitment and resource placement.
- Other approved outsourcing projects.

Each opportunity should include a title, scope, required skills, budget range, currency, deadline, delivery terms, application requirements, and attachments.

Vendors can view opportunities for which they are eligible, express interest, submit quotations, attach proposals, and track approval status.

Use a formal workflow:

Announcement → Vendor Application → Evaluation → Approved Vendor → Work Order → Delivery → Acceptance → Bill/Invoice → Payment.

Do not automatically award a contract because a vendor applied.

### Vendor ledger

Display:

- Opening balance.
- Approved vendor bills.
- Payments.
- Credit notes.
- Approved expense vouchers.
- Adjustments.
- Running balance.
- Credit balance or outstanding payable.
- Unpaid and partially paid invoices.

Provide PDF statements, downloadable vouchers, payment history, and contract documents.

### Vendor payments and vouchers

Allow an authorized finance user to issue and approve vendor payments. Reflect the resulting transaction in the vendor's portal and the relevant accounting ledger.

Support advances, partial payments, retentions, and refunds when applicable.

A voucher that is issued but not yet paid must not reduce cash or bank balances until the corresponding payment is posted.

## 22. Business partnerships and joint ventures

Create a separate module for Hifi's partnerships, strategic alliances, and joint ventures.

For every partnership, maintain:

- Partner entity and contacts.
- Agreement and supporting documents.
- Start/end dates and renewal conditions.
- Ownership or profit-sharing percentages.
- Capital contributions.
- Revenue-sharing terms.
- Expenses and cost allocations.
- Monthly income and profit distributions.
- Amounts receivable or payable.
- Outstanding partner balances.
- Payment records and expense vouchers.
- Supporting invoices and receipts.
- Tax and currency information.
- Approval and amendment history.

Support both percentage-based and fixed-fee commercial arrangements.

### Partner portal

Provide restricted partner access to:

- Their agreements.
- Approved statements.
- Transactions relevant to the partnership.
- Payments and amounts due.
- Documents requiring signature or review.
- Issued expense vouchers.
- Announcements and communications.

### Example: company formation fee

If Hifi pays a formation fee on behalf of a joint venture, record the expense with the appropriate accounting treatment, link it to the JV, and determine whether it is reimbursable or chargeable under the agreement.

If the partner has paid that amount themselves, record the appropriate contribution, reimbursement, or settlement transaction.

Never deduct the same expense twice or confuse a payable with a completed payment.

## 23. Fixed asset management

Build an asset register for laptops, mobile phones, furniture, office equipment, vehicles, and other company property.

Fields should include:

- Asset ID and name.
- Category.
- Serial number.
- Purchase date.
- Supplier.
- Purchase cost and currency.
- Tax and associated costs.
- Assigned employee.
- Department and branch.
- Location.
- Warranty and maintenance dates.
- Useful life and depreciation method.
- Accumulated depreciation.
- Net book value.
- Asset status.
- Transfer and maintenance history.
- Disposal date and proceeds.
- Invoice, warranty, and purchase documents.

Support asset assignment and return when employees join, change roles, or leave.

Generate depreciation schedules and corresponding accounting entries according to configured accounting policy.

Do not treat every asset purchase as an ordinary operating expense if capitalization criteria apply.

## 24. Marketing campaign and advertising analytics

Build a dedicated Marketing Operations module connected to client accounts, projects, budgets, content, and finance.

### Campaign configuration

Support:

- Client and project.
- Platform: Meta, Instagram, TikTok, Google, YouTube, LinkedIn, email, or other configured channels.
- Campaign name and objective.
- Account and campaign identifiers.
- Start/end dates.
- Budget and budget currency.
- Media spend.
- Agency/service fees.
- Taxes.
- Assigned ads manager and specialists.
- Target audience and regions.
- KPIs and conversion goals.

### Performance reporting

Track available metrics, including:

- Spend.
- Budget remaining.
- Reach.
- Impressions.
- Clicks.
- CTR.
- CPC.
- CPM.
- Leads.
- Cost per lead.
- Conversions.
- Conversion rate.
- CPA.
- Revenue and ROAS when verified conversion value is available.

Allow data imports from supported advertising platforms and structured CSV/XLSX reports.

Provide a mapping and validation interface for imported data. Detect duplicates and prevent repeated imports from double-counting spend or conversions.

Support manual performance entry by an authorized project manager, including the source and reporting period. Clearly label manually entered results.

Display data freshness and source information. Missing metrics should remain unavailable rather than being presented as zero performance.

### Budget versus spend

Keep these distinct:

- Approved media budget.
- Actual platform spend.
- Client-funded advertising balance.
- Agency management fee.
- Tax.
- Amount invoiced.
- Amount collected.
- Remaining funds or client credit.

Never assume that client-funded advertising money is Hifi's earned revenue. Configure the appropriate accounting treatment for agency fees, media spend, client advances, and pass-through expenses.

## 25. Project quality, client reviews, and success incentives

Create a Success Management module for reviewing delivery quality and client satisfaction.

### Review cycles

Allow weekly, biweekly, monthly, milestone-based, and custom review schedules.

Success managers should evaluate criteria such as:

- Quality of work.
- On-time delivery.
- Accuracy and completeness.
- Communication.
- Responsiveness.
- Adherence to approved scope.
- Marketing or project performance against agreed KPIs.
- Client satisfaction.
- Documentation and reporting.

Each review should record the reviewer, project, review period, score, comments, evidence, improvement actions, and approval status.

### Client review portal

Allow authorized clients to:

- Rate deliverables or project quality.
- Submit star ratings.
- Add comments.
- Report issues.
- Request revisions.
- Confirm acceptance.
- View previous reviews and actions taken.

Distinguish internal success reviews from client-submitted ratings.

### Project success incentive

Support an editable incentive rule, with 4% of project value as an example default, not a universal fixed policy.

The authorized user should be able to configure:

- Eligible project value.
- Percentage or fixed amount.
- Incentive recipient.
- Review frequency.
- Minimum quality threshold.
- Payment collection requirements.
- Approval process.
- Payment schedule.
- Maximum cap, if applicable.
- Treatment of cancellations, refunds, or scope changes.

Capture the agreed incentive rule when the project is approved or the qualifying commercial agreement is established.

At each eligible review:

1. Evaluate the review period.
2. Calculate the quality score.
3. Verify qualifying project value and payment conditions.
4. Calculate the incentive according to the configured formula.
5. Obtain the required approval.
6. Record the incentive liability or accrual according to accounting policy.
7. Make it visible in the employee's incentive portal.
8. Post the relevant payroll or payable entry when the incentive is approved for accounting.
9. Record actual payment separately.

Avoid paying 4% repeatedly on the entire project value for every review period unless that exact cumulative formula is explicitly configured.

Provide configurable incentive rules for project managers, success managers, sales agents, sales managers, and other eligible employees. Prevent duplicate awards for the same qualifying event.

## 26. Employee productivity and work activity monitoring

Build a transparent employee time-tracking and productivity module inspired by the functional capabilities of GetWorkfolio-style systems.

The purpose is to help HR and management understand attendance, task time, workload, and project utilization for office-based, hybrid, and remote employees.

### Clock-in and clock-out

Employees should be able to:

- Clock in.
- Clock out.
- Start and end breaks.
- View today's tracked time.
- Review weekly and monthly timesheets.
- View assigned tasks.
- Add work notes.
- Request corrections.
- View approved and pending timesheet records.

Distinguish scheduled time, attendance duration, active computer time, idle time, break time, and time allocated to projects.

### Activity tracking

Where legally permitted and transparently disclosed, track configurable activity metrics such as:

- Total tracked time.
- Active time.
- Idle time.
- App usage duration.
- Website usage duration.
- Approved work-related activity categories.
- Keyboard and mouse activity counts.
- Task-linked work sessions.
- Breaks.
- Screenshots captured under the published monitoring policy.
- Screenshot timestamps.
- Device/agent status.
- Storage usage.
- Productivity summaries.

Keyboard tracking must not capture typed content, passwords, private messages, or keystroke contents. Record aggregate activity counts only.

Do not collect unrelated browsing or personal activity beyond the declared policy.

### Screenshot management

Allow HR or authorized administrators to configure screenshot intervals, subject to the company's written policy and applicable law.

Provide:

- Configurable intervals and monitoring schedules.
- Date and time filters.
- Employee and department filters.
- Project/task filters where available.
- Screenshot thumbnails and authorized full-size views.
- Capture timestamps.
- Secure storage and retention rules.
- Access logging.
- Deletion according to approved retention schedules.
- Storage consumption and screenshot count.
- A documented process for employee review or disputes.

Employees must be informed about monitoring, what is collected, when it operates, who can view it, and how long information is retained.

Do not activate covert screenshots, hidden screen sharing, hidden microphone/camera recording, or unapproved remote access. Monitoring should respect breaks and configured nonworking periods.

### Activity report

Provide filters for employee, department, branch, project, task, date range, and work location.

Display:

- Scheduled hours.
- Attendance duration.
- Active time.
- Idle time.
- Break time.
- Total tracked time.
- App and website usage summaries.
- Aggregate keystroke and click counts.
- Screenshot count and storage usage.
- Task completion.
- Approved versus disputed timesheets.
- Productivity trends.

Do not interpret raw keystrokes, clicks, or screen time as a definitive measure of employee performance. Provide context from task delivery, quality reviews, and agreed KPIs.

### Employee monitoring dashboard

HR should see authorized workforce trends, attendance exceptions, missing timesheets, and activity anomalies.

Project managers should see only the time and workload data needed for their assigned projects.

Managers should not automatically receive unrestricted access to all employee screenshots or private browsing records.

### Technical implementation

Prefer an auditable desktop agent or a suitable established monitoring integration if browser-only tracking cannot reliably meet requirements.

If a desktop agent is required, provide a separate, signed, transparent application with:

- Secure enrollment and authentication.
- Clear monitoring status.
- Explicit permissions.
- Minimal data collection.
- Encrypted transport and storage.
- Configurable capture schedules.
- Reliable offline buffering where appropriate.
- Device management and revocation.
- Centralized policy updates.
- Versioned audit logs.

The web application alone must not be represented as capable of silently collecting system-wide app usage, screenshots, or device activity that browser security prevents it from accessing.

## 27. Internal and client-facing communication integrations

Implement a centralized integration layer for:

- WhatsApp Business Platform.
- Email.
- Calendar providers.
- Advertising platforms.
- Telephony or dialer services.
- File storage.
- Video meeting providers.
- AI model providers.

### WhatsApp

Use an authorized WhatsApp Business integration.

Support, subject to provider capabilities:

- Approved message templates.
- Invoice and receipt delivery.
- Meeting reminders.
- Follow-up reminders.
- Client service updates.
- Inbound messages.
- Conversation history.
- Assignment to an employee.
- Delivery/read statuses where provided.
- Opt-in and opt-out records.

Do not assume that any arbitrary WhatsApp account can be connected or that every message can be sent without policy restrictions.

### Email

Support authorized sending domains, email templates, delivery status, inbound integration where configured, and activity history.

### Integration framework

For each integration, include:

- Secure credential configuration.
- Connection status.
- Permission scopes.
- Test connection.
- Webhook verification.
- Retry and error handling.
- Rate limiting.
- Idempotent event processing.
- Sync logs.
- Disconnect/reconnect controls.
- Documentation and setup instructions.

## 28. AI knowledge assistant across the ERP

Create a contextual AI assistant that can answer internal questions using authorized company knowledge.

It should help with:

- Service pricing and plan features.
- Sales scripts and objection handling.
- SOPs and HR policies.
- Project status summaries.
- Finding overdue tasks.
- Explaining financial reports.
- Locating relevant documents.
- Summarizing authorized meetings.
- Generating draft emails and reports.
- Explaining CRM and ERP workflows.

Use retrieval-augmented generation where appropriate, with document indexing, source attribution, and permission-aware retrieval.

The assistant must respect the requesting user's permissions at retrieval time. Do not rely only on instructions in the AI prompt to secure sensitive data.

For accounting, payroll, and legal matters, provide source records, calculation details, and relevant disclaimers. AI-generated figures must be validated against the system's authoritative records.

Any action that changes financial records, employee status, permissions, contracts, or other sensitive information must require explicit authorization and the appropriate workflow.

## 29. Dashboards and analytics

Create different dashboards for each role.

### Super Admin / Executive dashboard

Display:

- Total revenue, collected cash, and outstanding receivables.
- Monthly recurring revenue where applicable.
- New leads and qualified opportunities.
- Closed deals and conversion rates.
- Active clients and renewals.
- Project delivery status.
- Project profitability.
- Departmental budgets and spending.
- Payroll obligations.
- Vendor payables.
- Investment income and partnership distributions.
- Asset register summary.
- Employee attendance and workload summaries.
- Client satisfaction trends.
- Alerts requiring management attention.

### Finance dashboard

Display:

- Cash and bank balances.
- Invoices issued.
- Collections received.
- Overdue receivables.
- Payables due.
- Expense vouchers awaiting approval.
- Posted expenses.
- Budget versus actual.
- Profit and loss.
- Tax summaries.
- Currency exposure.
- Bank reconciliation status.
- Payroll posting and payment status.
- Unreconciled accounts and accounting exceptions.

### HR dashboard

Display:

- Total active employees.
- Attendance summary.
- Late arrivals and missing punches.
- Leave applications.
- Upcoming employee document expiries.
- Payroll processing status.
- Performance reviews due.
- Employee workload summaries.
- Recruitment and onboarding status.

### Sales dashboard

Display:

- Personal and team targets.
- Calls attempted and connected.
- New CRM leads.
- Prospecting records processed.
- Follow-ups due.
- Proposals sent.
- Deals won and lost.
- Pipeline value.
- Collected revenue.
- Eligible commissions.
- Leaderboard and achievement progress.

### Project manager dashboard

Display:

- Active projects.
- Tasks due today.
- Overdue tasks.
- Blocked tasks.
- Milestones approaching.
- Team workload.
- Pending internal review.
- Pending client approvals.
- Budget consumption.
- Actual versus estimated hours.
- Project profitability, subject to permission.
- Client satisfaction and quality review results.

### Client dashboard

Display only the client's own:

- Services and subscriptions.
- Project progress.
- Upcoming deliverables.
- Content awaiting approval.
- Marketing campaign reports.
- Invoices and receipts.
- Payments and ledger.
- Announcements.
- Support requests.
- Meetings and client actions.

### Vendor dashboard

Display only the vendor's own:

- Opportunities.
- Submitted quotations.
- Awarded work orders.
- Deliverables.
- Pending acceptance.
- Bills and vouchers.
- Payments.
- Outstanding balance.
- Downloadable statements.

### Report builder

Provide a flexible report center with:

- Date ranges and preset periods.
- Branch, department, employee, project, client, vendor, service, campaign, and currency filters where relevant.
- Search, sorting, and grouping.
- Totals and subtotals.
- Chart and table views.
- Saved reports.
- Scheduled delivery where configured.
- CSV/XLSX export where authorized.
- PDF export.
- Access-aware report sharing.

Reports must use the same underlying records as the operational modules. A dashboard must not independently calculate financial figures using a different formula than the ledger.

## 30. PDF generation and downloadable reports

Provide a consistent PDF generation service for finance managers, super administrators, and other authorized roles.

Allow PDF download from:

- Dashboard reports.
- Financial statements.
- Customer ledgers.
- Vendor ledgers.
- Expense vouchers.
- Invoices and receipts.
- Project reports.
- Advertising performance reports.
- HR and attendance reports.
- Payroll registers and payslips.
- Employee activity reports.
- Investment and partnership statements.
- Asset reports.

Include report title, selected filters, organization identity, currency, generated date/time, page numbers, and appropriate confidentiality notices.

Respect permissions when generating PDFs. A user must not gain access to restricted data by exporting a report that would otherwise be unavailable in the interface.

For long-running reports, use a background job, show progress, and notify the user when the document is ready.

## 31. Data model and entity relationships

Design a normalized relational database with foreign keys, appropriate indexes, unique constraints, audit fields, and migrations.

Create entities for at least the following domains:

Identity: Organizations, Branches, Departments, Users, Roles, Permissions, UserRoleAssignments, EmployeeProfiles, Sessions.

CRM: Leads, Contacts, Companies, Opportunities, PipelineStages, Activities, CallLogs, Campaigns, SmartLists, Worklists, WorklistRows, ImportJobs, Proposals, Deals.

Commercial: ServiceCategories, Services, ServicePlans, PlanVersions, PlanFeatures, PriceBooks, RegionalPrices, Quotes, QuoteItems, Contracts, ContractItems, Subscriptions, SubscriptionItems, AddOns.

Projects: Projects, ProjectMembers, Tasks, Subtasks, TaskComments, TaskAttachments, Milestones, Dependencies, Deliverables, ContentItems, ApprovalRequests, ProjectReviews, ReviewCriteria, IncentiveRules, IncentiveAccruals.

Finance: ChartOfAccounts, FiscalPeriods, JournalEntries, JournalLines, Invoices, InvoiceLines, Payments, PaymentAllocations, Receipts, CreditNotes, Refunds, ExpenseVouchers, VendorBills, Budgets, BudgetAllocations, BudgetTransfers, ExchangeRates, BankAccounts, BankTransactions, Reconciliations, TaxRates.

HRM: Employees, EmployeeDocuments, Shifts, AttendanceRecords, BreakRecords, Timesheets, LeaveTypes, LeaveBalances, LeaveRequests, PayrollPeriods, PayrollRuns, PayrollItems, Payslips, CommissionRules, CommissionEntries, BonusEntries.

Vendors: Vendors, VendorContacts, VendorOpportunities, VendorApplications, VendorQuotes, PurchaseOrders, WorkOrders, VendorContracts, VendorPayments, VendorLedgerEntries.

Investments and assets: Investments, InvestmentTransactions, Partnerships, PartnershipAgreements, PartnerContributions, ProfitDistributions, Assets, AssetAssignments, DepreciationSchedules, AssetDisposals.

Communication: Announcements, Notifications, Conversations, Messages, Attachments, Meetings, MeetingParticipants, MeetingRecordings, Transcripts, ActionItems, IntegrationConnections, WebhookEvents.

Monitoring: MonitoringPolicies, DeviceEnrollments, WorkSessions, AppUsageRecords, WebsiteUsageRecords, ActivityAggregates, ScreenshotMetadata, ScreenshotAccessLogs, RetentionJobs.

Governance: AuditLogs, ApprovalRequests, ApprovalSteps, CustomFields, CustomFieldValues, ReportDefinitions, ExportJobs.

Refine this list as needed to avoid redundant entities. Use explicit relationships rather than storing all business information in unstructured JSON.

### Critical data rules

- Use immutable IDs rather than names as relationships.
- Use decimal or fixed-precision numeric types for financial amounts, not floating-point types.
- Store timestamps consistently and display them in the relevant user's or organization's timezone.
- Store currency codes explicitly.
- Snapshot commercial terms and applicable rates on approved transactions.
- Maintain historical plan versions.
- Enforce tenant and organization boundaries.
- Use soft deletion only where appropriate and never silently erase posted financial history.
- Create database constraints for critical uniqueness and integrity requirements.
- Add indexes for common filters, joins, and report queries.
- Use pagination for large data sets.
- Keep an auditable record of important state transitions.

## 32. Unified workflow and automation engine

Implement a centralized event and automation layer so that modules stay synchronized.

Examples:

| Event                       | Required downstream actions                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Lead converted to customer  | Link CRM records, create customer account, initiate proposal/invoice workflow, create onboarding tasks              |
| Deal approved               | Snapshot commercial terms, create project if applicable, record incentive rules                                     |
| Invoice posted              | Update receivables, ledger, financial reports, and client portal                                                    |
| Payment posted              | Allocate payment, update invoice balance, customer ledger, cash/bank accounts, and eligible commission calculations |
| Task completed              | Update task status, project progress, activity timeline, and relevant notifications                                 |
| Content approved            | Update approval status, notify assigned team, and allow scheduling workflow                                         |
| Vendor work approved        | Update acceptance status and allow authorized bill/payment processing                                               |
| Expense posted              | Update project actual cost, general ledger, budget reporting, and expense reports                                   |
| Leave approved              | Update leave balances and relevant attendance/planning views                                                        |
| Payroll posted              | Create payroll journal entries and update payroll liabilities                                                       |
| Asset purchased             | Update asset register and appropriate accounting records                                                            |
| Client review completed     | Update review history and calculate eligible incentives according to policy                                         |
| Partnership income received | Update the relevant investment/partnership records and accounting entries                                           |

These are business-event examples, not permission to blindly execute every downstream operation.

Each workflow must have:

- Defined triggering event.
- Preconditions and permissions.
- Required approvals.
- Idempotency key.
- Transaction boundaries.
- Retry strategy.
- Failure reporting.
- Audit history.
- Notification rules.

Do not implement financial side effects through fragile frontend-only callbacks.

## 33. Security, privacy, and auditability

Implement:

- Secure authentication.
- Role-based and record-level authorization.
- Optional multi-factor authentication.
- Secure password reset and account recovery.
- Session management and revocation.
- Rate limiting.
- CSRF protection where applicable.
- Input validation and output encoding.
- SQL injection protection.
- File type and size validation.
- Malware scanning where supported.
- Private file storage and signed URLs.
- Secrets management.
- Encryption in transit and appropriate encryption at rest.
- Backup and restore procedures.
- Audit logging.
- Data export restrictions.
- Retention and deletion policies.
- Security headers and secure cookie settings.
- Protection against insecure direct object references.
- Appropriate protection against cross-site scripting and server-side request forgery.

Use audit logs for financial postings, approvals, permission changes, contract amendments, payroll publication, client data access where required, and sensitive employee-monitoring access.

Record actor, action, timestamp, entity, record ID, and appropriate before/after metadata without unnecessarily duplicating sensitive data into logs.

Treat external integrations, uploaded documents, email contents, and AI-retrieved information as untrusted input.

Do not place secrets in source code, browser bundles, logs, or downloadable reports.

## 34. Testing and quality assurance

Build automated tests as features are implemented, not only at the end.

Required test categories:

- Unit tests for calculations and domain rules.
- Integration tests for database transactions.
- API tests for validation and permissions.
- End-to-end tests for critical user journeys.
- Regression tests for existing functionality.
- Import/export tests.
- PDF generation tests.
- Multi-currency tests.
- Concurrency and idempotency tests for financial posting.
- Security tests for cross-client and cross-vendor access.
- Accessibility checks for core workflows.

### Mandatory acceptance scenarios

1. A sales agent creates a lead and advances it through the sales pipeline.
2. A manager approves a deal and its custom service package.
3. The system creates the appropriate customer record without duplicating the contact.
4. The customer receives a portal account with restricted access.
5. The initial invoice is generated and posted through the correct approval workflow.
6. A partial payment updates the customer ledger and outstanding invoice balance.
7. The payment appears in the appropriate cash/bank account and financial reports.
8. The project manager assigns tasks to a designer, editor, developer, or ads specialist.
9. The client sees only approved client-facing project updates.
10. The client reviews and approves or requests changes to content.
11. The client can download authorized invoices, receipts, and account statements.
12. A vendor applies for an outsourcing opportunity and is awarded a work order after approval.
13. The vendor completes the assigned work and submits the relevant billing documentation.
14. Finance approves and posts the vendor bill and payment correctly.
15. HR approves leave and the leave balance is updated correctly.
16. Payroll is calculated, approved, posted, and made visible only to authorized users.
17. A sales commission is calculated once according to the configured deal and payment policy.
18. A project success incentive is calculated once according to the approved review and incentive rules.
19. An expense voucher updates project cost and accounting records without duplicate expense recognition.
20. An asset purchase appears in the asset register and the correct accounts.
21. Investment and partnership income are recorded and reconciled with actual receipts.
22. Monitoring records respect employee policy, access permissions, and configured retention.
23. Unauthorized users cannot access another client, vendor, employee, or organization's private data.
24. Reports reconcile to their underlying ledgers and transactions.
25. Retrying an integration webhook or financial event does not create duplicate records.

## 35. Implementation roadmap

Build the application in controlled, testable phases.

Phase 0

Repository audit and foundation

Inspect existing stack, document architecture, establish migrations, design system, authentication, RBAC, organization structure, audit logs, and test environment.

Phase 1

CRM and commercial engine

Leads, contacts, opportunities, Smart Lists, worklists, sales pipelines, service catalog, regional pricing, quotes, contracts, and client conversion.

Phase 2

Client portal and project delivery

Client accounts, project creation, tasks, teams, content calendar, approvals, client updates, and deliverable tracking.

Phase 3

Accounting and finance

Chart of accounts, journals, invoices, receipts, payments, ledgers, expense vouchers, budgets, project cost accounting, reports, and PDFs.

Phase 4

HRM and sales incentives

Employee records, attendance, leave, payroll, commission, gamification, and project success incentives.

Phase 5

Vendor, asset, and investment modules

Vendor portal, outsourcing marketplace, work orders, partnership/JV management, investments, and fixed assets.

Phase 6

Collaboration and integrations

Notifications, chat, WhatsApp, email, advertising data, conferencing, meeting transcripts, and remote support integration.

Phase 7

Monitoring and AI

Transparent activity tracking, authorized screenshot workflows, AI sales copilot, internal knowledge assistant, and reporting intelligence.

Phase 8

Production readiness

Security review, performance optimization, backups, migration rehearsal, accessibility, acceptance tests, deployment, and operations documentation.

Do not attempt to build every advanced integration in one untested implementation. Complete the core data model and financial workflows first, then expand through stable interfaces.

At the end of each phase, run the relevant automated tests, verify the critical user journeys, update documentation, and report what is complete versus what remains.

## 36. Super Admin configuration center

Build a powerful Super Admin portal with a left-side navigation menu and centralized configuration for the entire ERP.

The Super Admin should be able to manage:

- Organization profile and company documents.
- Branches, departments, designations, and reporting hierarchy.
- Employees, users, roles, and permissions.
- Service categories, plans, features, and regional prices.
- Currency settings, exchange rates, and fiscal periods.
- Chart of accounts, tax rules, numbering formats, and accounting policies.
- Invoice, receipt, quotation, and voucher templates.
- Sales targets, commission policies, rebates, and incentive rules.
- Project workflows, task templates, and approval chains.
- Attendance, shifts, leave policies, and monitoring settings.
- Notification templates and escalation rules.
- Client and vendor portal branding.
- AI provider settings, knowledge sources, and usage limits.
- Integration credentials and connection status.
- Document storage and retention settings.
- Audit logs, backups, and system health.
- Custom fields, dropdowns, statuses, and workflow rules.

Include a configuration change history showing who changed a setting, when it changed, and the effect on future operations.

Changes to financial rules should not silently rewrite historical transactions. Version accounting rules and commercial pricing so historical records retain their original values.

## 37. Deployment and developer experience

Provide everything required to run, test, maintain, and deploy the system.

Required deliverables:

- A clean and organized codebase.
- Database schema and versioned migrations.
- Seed data for development and demonstration.
- `.env.example` with placeholder values only.
- Installation and startup instructions.
- Local development instructions.
- Test commands.
- Build and lint commands.
- API documentation.
- Role and permission matrix.
- Data model documentation.
- Integration setup guides.
- Database backup and restoration instructions.
- Production deployment documentation.
- Background worker and scheduled job instructions.
- Monitoring and logging recommendations.
- Known limitations and future enhancements.

Provide realistic demo records for each major role, including sample clients, projects, tasks, plans, invoices, payments, vendors, employees, and reports. Clearly separate demo data from production data.

Never place actual client records, production credentials, or real payroll data in seed files.

## 38. Final execution instructions for Claude Code

Start by auditing the existing project and return a concise implementation assessment covering:

1. Current framework and architecture.
2. Existing pages and functional modules.
3. Current database schema and relationships.
4. Existing authentication and authorization.
5. Reusable components and integrations.
6. Broken workflows, duplicate data structures, or synchronization gaps.
7. Highest-priority missing features.
8. Recommended implementation sequence.

Then begin implementation. Do not stop after writing a plan or generating a long specification.

For every feature:

- Build the frontend and backend.
- Implement the database changes.
- Connect the feature to its relevant modules.
- Add authorization and validation.
- Handle failures and duplicate requests.
- Add audit logging where required.
- Write tests.
- Verify the feature in the running application.
- Update the documentation.

When the work exceeds the available session, leave the repository in a working state and document the completed phase, outstanding issues, and the exact next implementation steps.

### Definition of done

A feature is not complete merely because its page looks correct. It is complete when its underlying data persists, permissions are enforced, business rules work, related modules synchronize correctly, relevant reports reconcile, and automated tests pass.

The ultimate objective is one reliable business operating system for Hifi Marketing and Technologies—not multiple disconnected applications sharing a dashboard.

END OF CLAUDE CODE PROMPT

## Additional recommendations before development

There are three decisions worth settling early because they affect the architecture significantly.

1\. Establish the accounting foundation first

The chart of accounts, double-entry journal, currency handling, and payment allocation engine should be implemented before advanced financial dashboards. This will prevent inconsistencies between client ledgers, project budgets, commissions, vendor balances, and company reports.

2\. Make every business transaction flow through shared records

A single customer payment should update the invoice, customer ledger, bank/cash account, project collection metrics, and eligible commission calculation. Build one authoritative payment workflow rather than separate payment fields in each module.

3\. Separate core ERP features from advanced integrations

Build the CRM, project workflows, accounting, HRM, and portals first. Integrate video conferencing, desktop activity monitoring, WhatsApp, ad platforms, and AI through well-defined interfaces. Some capabilities require third-party services, separate desktop software, or additional infrastructure.

Add the following section to the end of your existing Claude Code master prompt. It extends the requirements for an interactive Flowlu/Bordio-style interface and makes all company information—including bank accounts—editable from the Super Admin settings.
Additional Claude Code Prompt: Interactive UI + Company Settings
Copy and append the following to your existing master prompt.
39. Interactive UI/UX inspired by Flowlu and Bordio
Design Hifi One as a fully interactive business operating system inspired by the usability, navigation, collaboration, and project workflows of Flowlu and Bordio.
Do not merely imitate their appearance. Adopt their useful interaction patterns and improve them for Hifi's interconnected CRM, ERP, project delivery, HRM, and finance workflows.
Interactive application behavior

* Dynamic sidebar: collapsible, searchable, role-based, with expandable menu groups, pinned favorites, and recently visited records.
* Drag-and-drop boards: move CRM opportunities, tasks, project deliverables, and content items between stages. Save changes to the backend immediately and enforce valid transitions.
* Calendar and timeline: interactive day, week, month, and agenda views with task scheduling, meetings, deadlines, and leave calendars.
* Project workspace: switch between Kanban, list, calendar, Gantt/timeline, workload, and milestone views without losing filters or project context.
* Quick actions: create leads, clients, projects, tasks, invoices, expenses, and meetings from a global quick-action menu.
* Interactive dashboards: date filters, clickable KPI cards, drill-down charts, sortable tables, and saved report views.
* Live collaboration: task comments, mentions, activity feeds, employee avatars, status updates, and notifications.
* Contextual panels: open client, task, lead, or project details in side panels where appropriate instead of repeatedly navigating away.
* Bulk actions: assign records, update statuses, add tags, export authorized data, and perform approved batch operations.
* Personalized workspaces: each employee sees relevant assignments, upcoming deadlines, notifications, attendance, meetings, and targets.
* Keyboard accessibility: shortcuts for global search, quick creation, navigation, and common actions.
* Responsive interactions: desktop drag-and-drop should have accessible touch-friendly alternatives on mobile.

UI quality standards

1. Use reusable components and a consistent design system.
2. Provide immediate visual feedback for actions, including loading, success, error, and undo states where safe.
3. Support optimistic updates only when conflicts can be reconciled safely.
4. Persist saved filters, views, sorting preferences, and permitted dashboard layouts.
5. Use confirmation dialogs for destructive or financially significant actions.
6. Never rely on frontend hiding alone for authorization.
7. Provide clear empty states and guided onboarding for new users.
8. Avoid unnecessary page reloads.
9. Keep the interface responsive when tables contain thousands of records.
10. Maintain consistent visual language across employee, client, vendor, and administrative portals.

Interactive project workspace
Every project should have a workspace with contextual tabs:

* Overview
* Tasks and Subtasks
* Timeline and Gantt
* Team and Workload
* Deliverables
* Content Calendar
* Discussions
* Meetings
* Files and Documents
* Budget and Costs
* Client Approvals
* Reports
* Activity History
* Project Settings

Tabs must be permission-aware and use real data. Dragging a task to another status must persist the change, update relevant project progress, record the activity, and notify affected users.
Interactive CRM workspace
Provide Kanban and list views with configurable pipeline stages, lead cards, filters, saved Smart Lists, follow-up reminders, and quick access to client conversations.
When opening a lead, display a contextual workspace containing profile information, assigned agent, contact history, notes, tasks, appointments, documents, proposals, campaign, and conversion actions.
Interactive finance workspace
Provide searchable invoice and payment registers, customer/vendor account statements, interactive budget-versus-actual charts, and transaction drill-downs.
Selecting a financial figure should open its supporting records, subject to permissions. Use consistent calculations between the dashboard, report, ledger, and downloadable PDF.
40. Official company information and document branding
Preconfigure the company profile with the following supplied information.
Company name
Hifi Marketing and Technologies
Global UAN
+1 778-652-1616
Registered office — USA
7901 4TH ST N, STE T, St. Petersburg, FL 33702, Florida, USA
Confirm the exact suite/address formatting before finalizing official legal documents.
Sales Centre — Pakistan
PZT Tower, adjacent to DHA Phase 1, Islamabad
Local UAN
+92 316 8080801
Use these values as initial company-profile records, not hardcoded constants. All company details must be editable by authorized administrators.
41. Super Admin — Company Settings Center
Create a dedicated Settings → Company Settings section with a left-side settings menu and a structured editing workspace.
Company Settings
Centralized, editable configuration for all company-wide information.
1. General Information
Legal name, trading name, logo, brand colors, website, email, registration details, and company description.
2. Offices and Branches
Registered offices, sales centres, branch addresses, contacts, operating hours, and regional timezones.
3. Contact Information
Global and local UANs, telephone numbers, support emails, sales emails, WhatsApp Business details, and authorized contact channels.
4. Bank Accounts
Bank name, account holder, account number, IBAN, SWIFT/BIC, routing or sort code, branch, country, currency, and payment instructions.
5. Invoicing and Receipts
Document prefixes, numbering sequences, payment terms, due dates, footer text, invoice notes, receipt format, and branding.
6. Tax and Legal
Applicable registration numbers, tax IDs, tax rules, legal notices, registered jurisdiction, and configurable document disclosures.
7. Currency and Financial Settings
Functional currency, supported currencies, rounding, exchange-rate source, fiscal year, financial periods, and reporting preferences.
8. Payment Methods
Bank transfer, authorized payment gateways, cash, card, and other configured payment methods.
9. Expense Voucher Settings
Voucher prefixes, expense categories, approval thresholds, approvers, and required attachments.
10. Branding and Documents
Company logo, invoice/receipt/voucher templates, signatures, letterheads, colors, PDF layouts, and email templates.
11. Notifications and Communication
Notification templates, email sender details, WhatsApp settings, escalation rules, and communication preferences.
12. Regional Preferences
Default timezone, date format, language, address format, and number formatting.
13. Security and Audit
Authorized settings administrators, approval requirements, access history, change logs, and sensitive-field protection.
Company settings behavior

* Each section must have its own editable form and appropriate validation.
* Support save, cancel, preview, and reset-to-approved-default actions.
* Show the current value and the last update time.
* Log the administrator responsible for each change.
* Require additional authorization for sensitive financial and legal changes.
* Preserve historical invoice, receipt, and contract snapshots when company details change.
* Allow separate legal entities, branches, and document profiles when the organization requires them.
* Allow a default company profile while supporting the selection of the correct entity for each invoice, contract, or financial document.
* Use a reusable settings service so other modules retrieve the current authorized configuration from the backend.
* Do not overwrite historical documents when updating current contact details, bank accounts, or branding.

42. Bank account management
Create a dedicated Company Settings → Bank Accounts screen.
Each bank account should support:

* Internal account name.
* Bank name.
* Account holder/legal entity.
* Country and branch.
* Account number.
* IBAN where applicable.
* SWIFT/BIC.
* Routing number or sort code where applicable.
* Account currency.
* Account type.
* Ledger account mapping.
* Default account for a currency or legal entity.
* Active/inactive status.
* Payment instructions for invoices.
* Authorized-user visibility.
* Reconciliation settings.
* Supporting documents and verification status.

Provide an interactive bank account register with search, filters, edit actions, and a detail view.
Allow different bank accounts for PKR, USD, AED, and GBP. Allow one or more accounts per currency and legal entity.
Bank account security

* Mask account numbers by default.
* Restrict full account details to authorized users.
* Require reauthentication or additional confirmation for sensitive changes where supported.
* Never expose bank account credentials or online banking passwords.
* Do not store internet banking login credentials.
* Log changes to payment instructions and default bank accounts.
* Require appropriate approval before using a newly added or modified account for sensitive payment workflows.
* Keep historical payment records linked to the account used at the time of the transaction.

Payment instruction synchronization
When an authorized administrator updates company payment instructions, the updated information should be available for newly generated invoices, quotations, and payment instruction documents.
Previously issued invoices must retain the bank details and document snapshot that were issued to the client, unless an authorized correction or reissue workflow is performed.
Where a payment gateway or banking API is connected, keep the connection credentials in secure secrets management and the account metadata in the database. Never treat manually entered bank details as proof that an account is verified or connected.
43. Document templates and company-profile synchronization
Create a document-template manager for:

* Invoices.
* Receipts.
* Quotations.
* Expense vouchers.
* Credit notes.
* Customer statements.
* Vendor statements.
* Contracts.
* Payslips.
* Financial reports.
* Project reports.
* Official letters.

Allow authorized users to configure which company details appear on each document, including logo, registered office, sales centre, phone numbers, email, website, bank instructions, tax details, and legal footer.
Support document previews before publishing templates.
Each generated document must store its template version and relevant company-profile snapshot so historical records remain auditable.
44. Final verification for the new requirements
Before marking this enhancement complete, verify the following:

1. The application uses interactive Kanban, calendar, list, and project views rather than static mockups.
2. Drag-and-drop changes persist and respect workflow permissions.
3. The company profile contains the supplied Hifi name, UANs, and office information.
4. Super Admin can edit and save company information without code changes.
5. Authorized users can add, edit, deactivate, and view company bank accounts according to permissions.
6. Invoice, receipt, and voucher templates retrieve company details from the settings service.
7. Bank instructions appear correctly on new documents.
8. Previously issued documents retain their historical snapshots.
9. Sensitive bank details are masked for unauthorized users.
10. Company-setting changes produce audit records.
11. Financial and document workflows continue to work after settings are changed.
12. All relevant automated tests pass.

Implementation requirement: Inspect the current repository, integrate these changes into the existing architecture, implement the backend and frontend, and test the complete workflows. Do not deliver a visual-only prototype.
This addition makes the company profile and bank details centrally configurable, while ensuring changes flow into future invoices, receipts, vouchers, and reports without corrupting historical financial records.

(attached is the logo file)