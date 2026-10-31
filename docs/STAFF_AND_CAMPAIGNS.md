# Staff, roles, campaigns and dashboard routing

Feature reference for the staff directory, sign-in by email or phone, the agency roles, campaign management and the clickable dashboard. Code is the source of truth; fix this file in the same change when it drifts.

## Entities

| Thing | Record | Notes |
|---|---|---|
| Staff member | `User` (sign-in, roles, active) + `EmployeeProfile` (HR record), linked by `EmployeeProfile.userId` (foreign key) | One person, one of each. Employee ID `E-0001` from `NumberSequence` key `EMP`. |
| Official email | `User.email` (optional, unique) | Never invented. `emailVerifiedAt` set when the person resets their password from an emailed link, or by an administrator. |
| Contact number | `User.phone` (optional, unique, E.164 such as `+923001234567`) | Used to sign in. `phoneVerifiedAt` set by an administrator (no SMS provider). |
| Alternate contact | `EmployeeProfile.phone` | Free text; staff can still edit their own on My Profile. |
| CNIC | `EmployeeProfile.identityNumber` | Stored as `12345-1234567-1`. Read and written only with `hr.view_sensitive`; never in lists, exports or audit entries. |
| Department, reporting manager | `User.departmentId`, `User.managerId` | `EmployeeProfile.departmentId` is kept equal. |
| Status | `EmployeeProfile.status` ACTIVE / INACTIVE / EXITED, plus `archivedAt` | Anything but ACTIVE sets `User.active = false` and ends sessions. Nothing is deleted. |
| Campaign | `Campaign` | Code `CMP-0001` (`NumberSequence` key `CAMPAIGN`), name unique regardless of capitals, `categoryId`, `description`, `objectives`, `ownerId`, dates, optional `budget` + `currency`, `status` PLANNED / ACTIVE / PAUSED / DONE, `archivedAt`. |
| Campaign team | `CampaignMember (campaignId, userId)` | The owner is always on the team. Appears in each member's My tasks. |
| Campaign clients | `CampaignClient (campaignId, clientId)` | Links to the canonical `Client`. |
| Campaign work | `Project.campaignId`, `Lead.campaignId` | Tasks belong to projects, so a campaign's tasks are the tasks of its projects. No separate deliverable record yet. |
| Categories | `ServiceCategory` (shared by the service catalog and campaigns) | One list, managed in the catalog. "SaaS" is the existing **SaaS Products and Subscriptions** entry; no second list was created. |

Services: `src/lib/staff.ts`, `src/lib/campaigns.ts`, `src/lib/login-identifier.ts`, `src/lib/password-help.ts`, `src/lib/sms.ts`, `src/lib/initial-records.ts`. Tests: `staff-campaigns.integration.test.ts`, `login-identifier.test.ts`, `date-range.test.ts`.

## Sign-in rules

- The sign-in box takes the registered email or the registered contact number. The number is normalised first (`03001234567`, `+92 300 1234567` and `0092 300 1234567` are the same account); a number without a country code that does not start with 0 is refused rather than guessed.
- A password is always required (and the two-step code when it is on). A phone number alone never signs anyone in.
- Errors never say which part was wrong. Attempts are limited per address and per identifier; five failures lock the account for 15 minutes.
- New staff get no usable password. Someone with `users.manage` creates a one-time **setup link** (72 hours) from the staff record and sends it themselves; the person chooses their own password.
- **Forgot password** (`/login/forgot`) always shows the same message. It emails a one-hour link only when the account has an email and outgoing mail is configured; the outbox keeps the message without the link. Numbers get nothing until an SMS provider exists.
- **SMS:** not configured. `src/lib/sms.ts` is the boundary: set `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_FROM` and implement the provider in `PROVIDERS`. Until then the screens say numbers are verified by an administrator.

## Roles

| Role | Purpose (key permissions) |
|---|---|
| Super Admin | Everything. The system refuses to remove the last active one. |
| Chief Marketing Officer (`CMO`) | Executive dashboard, all leads, catalog, campaigns (manage), content, staff directory (no CNIC). |
| Chief Operating Officer (`COO`) | Executive dashboard, all projects (manage), campaigns (manage), staff directory, attendance, vendors and budgets (view). |
| HR Coordinator | Staff directory and records including CNIC, leave approval, attendance. Two-step verification required on new installations. |
| Sales Agent | Own leads, quotations, own commission, campaigns (view). |
| Ads Manager | Projects and tasks, content (view), campaigns (view). |
| Project Manager | Projects (manage), content, vendors, budgets (view), campaigns (view). |
| AI Developer Intern | Own projects and tasks, self-service only. |

Full matrix: `docs/ROLES.md` (`npm run docs:roles`). New permissions reach existing roles once, when first introduced, following `src/lib/permissions.ts`; after that the Roles screen owns each role.

The two named Super Admins hold `SUPER_ADMIN` plus `CMO` / `COO`. A development database also has the demo Super Admin from `npm run db:seed`; production does not.

## Dashboard and report routing

Every number card (`Stat` with `href`) and bar row opens the list it counts, with the filter in the address, an "Filtered by" bar (`AppliedFilters`) that can remove each filter, and a link back to the dashboard (`from=dashboard` or `src=dashboard`).

| Card | Opens |
|---|---|
| Hero: Collected | `/finance/payments?from=…&to=…` (received in the period) |
| Hero: Overdue | `/finance/reports?type=aging` |
| Hero: New leads | `/leads?from=…&to=…` (created in the period) |
| People: Active staff | `/hr/employees?status=ACTIVE` |
| People: by department / designation | `/hr/employees?status=ACTIVE&dep=…` / `&designation=…` |
| Campaigns: total, active, mine | `/campaigns`, `?status=ACTIVE`, `?member=me` |
| Campaigns: by category / status | `/campaigns?category=…` / `?status=…` |
| Campaigns: linked projects | `/projects?campaign=linked` |
| Campaign page: team, leads, projects | `/hr/employees?campaign=…`, `/leads?campaign=…`, `/projects?campaign=…` |

Lists page 50 rows at a time; the staff directory exports CSV for the current filters (no CNIC or bank details). Cards a role cannot open are shown without a link.

## Seeding the initial records

`npm run seed:initial` (safe in production, safe to rerun) registers new roles and permissions, ensures the baseline lists, then reconciles the initial staff and campaigns from `src/lib/initial-records.ts`:
- a person is matched by contact number, else by exact name; a campaign by name (any capitals);
- missing records are created; existing ones only get fields that are still empty and roles they lack;
- nothing is overwritten or removed and no password is set or reset.

Contact numbers and CNICs are not in source code. They are read from `.data/initial-staff-private.json` (git-ignored; path overridable with `INITIAL_STAFF_FILE`):

```json
{ "Full Name": { "phone": "+923001234567", "identityNumber": "1234512345671" } }
```

`npm run seed:initial -- --setup-links` with `APP_URL` set also writes one-time setup links for these people who have never signed in to `.data/staff-setup-links.txt`. Send them and delete the file.

Campaign status was not given for Classwell, Agentify ERP and Podvet, so they use the existing default (ACTIVE); no dates, budgets, owners, clients or metrics were invented.
