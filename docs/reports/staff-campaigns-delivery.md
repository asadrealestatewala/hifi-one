# Delivery report: staff, sign-in, roles, campaigns, dashboard

Branch `feat/staff-campaigns` (commit `b304ec1`), built on `feat/erp-consistency`. Not merged to `main`; the repository has no remote.

## What works (verified)

| Area | How it was verified |
|---|---|
| Staff directory: search, status, department, role, campaign and project filters, sort, paging, CSV without CNIC | Browser (admin), integration tests |
| Add staff with only a name; employee ID E-0011 assigned; no password set | Browser, tests |
| Duplicate number refused with the owner's name, typed values kept | Browser ("already belongs to Umair Qayyum") |
| Duplicate email and same-name confirmation | Tests |
| Setup link (72 h) lets the person choose a password | Browser |
| Sign-in with the phone number in `0300 …` and `+92 300 …` forms; wrong password refused with a generic message | Browser |
| Intern denied staff directory, campaigns and staff export | Browser (forbidden page) |
| Deactivate, exit, archive, restore; sessions end; last Super Admin protected | Tests; archive confirmed in browser |
| CNIC only with `hr.view_sensitive`; never overwritten by others | Tests |
| Campaign codes, shared category, owner always on team, team and clients, project links, metrics without double counting, archive | Tests; team assignment in browser |
| Campaign appears in the member's workload filter | Tests |
| Dashboard cards and bars open filtered lists with "Filtered by" and a way back | Browser (Campaigns and People tabs, team card) |
| Idempotent seed: second run creates nothing, keeps later edits and passwords | Tests; run twice on the development database |
| Checks | `tsc` clean, `eslint` clean, 793 tests in 59 files pass, `npm run build` succeeds |

## Database changes (additive)

- `20261013030000_staff_campaigns`: `User.email` nullable, `User.phone` (unique), verification dates; `EmployeeProfile.notes`, `archivedAt`; campaign code, category, description, objectives, owner, archive; `CampaignMember`, `CampaignClient`; `Project.campaignId`.
- `20261013030100_employee_user_link`: foreign key from `EmployeeProfile.userId` to `User` (checked: no orphan rows).

Apply with `npx prisma migrate deploy` (done on the development and test databases).

## Configuration

- Production: `npm run roles:sync` is not needed separately; `npm run seed:initial` registers the new roles and permissions, then reconciles the staff and campaigns. Put numbers and CNIC in `.data/initial-staff-private.json` (format in `docs/STAFF_AND_CAMPAIGNS.md`).
- Setup links for first sign-in: from each staff record (needs `users.manage`), or `APP_URL=… npm run seed:initial -- --setup-links`.
- Email reset links need SMTP settings. SMS needs a provider (`SMS_PROVIDER`, `SMS_API_KEY`, `SMS_FROM`) and code in `src/lib/sms.ts`; until then it shows as not configured.

## Decisions and limits

- "SaaS" uses the existing category **SaaS Products and Subscriptions** rather than a second list.
- The three campaigns were given the existing default status ACTIVE because no status was provided. No dates, budgets, owners, clients or metrics were invented.
- The development database also contains the demo Super Admin (`admin@hifi.local`) from the demo seed, so it has three Super Admins; a production installation made with `/setup` has the first administrator plus the two named people.
- A test staff record "Login Check Test" (E-0011) was created during the browser check on the development database and is archived.
- Not built: SMS sending, campaign deliverables as their own record, performance metrics beyond leads, wins, projects and tasks, sorting by clicking column headers.
- Not verified: the forgot-password email (no SMTP on this machine).
