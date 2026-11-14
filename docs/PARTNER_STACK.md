# Partner Stack (public name: Hifi Partner Stack)

Reseller and sales-partner programme. Inside Hifi One it is "Partner Stack" (`/partner-stack`); the public page, browser tab, emails, certificates and partner login say "Hifi Partner Stack" (`/partners`). UI word for the software lines is **Solutions** (`SaasProduct`), buyers are **Clients**.

## Phase 1 (landing page and onboarding) - built
- **Public**: `/partners` (hero, Solutions, partner types and rates, how it works, who can join, earnings calculator, benefits, FAQ, application form, question form), `/partners/verify/<id>` (certificate check: name, Solution, dates, status only). Everything shown (rates, validity days, terms, calculator example) comes from the database. These two pages may read the database but never a session and never write (`guards.test.ts`).
- **Forms**: `POST /api/partners/inquiry` and `/api/partners/apply`: same-site, size limited, per-IP rate limited, hidden honeypot field, minimum fill time. A second application from the same email while the first is open updates it. Applicant gets an auto-reply; everyone holding `partners.manage` gets an in-app notification.
- **Admin** (`partners.manage`; Settings needs `partners.settings`, Super Admin only): Applications (approve with type, rate, duration, territory, lead sharing, Solutions, "certify now" ticks; or reject with an emailed reason), Partners (edit any term, suspend, issue certificate), Certificates (PDF, renew keeping the ID, revoke with reason), Inquiries, Settings.
- **Role**: "Partner Manager" holds `partners.manage`. Super Admin holds both permissions. Assign the role to anyone to hand the programme over.
- **Certificates**: one per partner and Solution, public id `HPS-XXXX-XXXX-XX`, QR code to the verify page, landscape A4 PDF made with pdfkit. Validity: the partner's own days, else the Solution's, else the global default (30). The daily job "Partner certificate reminders" emails 7 days and 1 day before expiry (both configurable) and tells the Partner Managers. Reminders are sent once per validity period.
- **Partner login**: approval creates a `User` with `userType = PARTNER` and no staff roles, bound to one `Earner`. A set-password link (72 hours) is emailed. `requirePartnerUser()` derives the earner from the session; `/partner` is the home (terms, Solutions, certificates with PDF download). Staff pages send partners to `/partner`.

## Data (migration `20261114003112_partner_stack`, additive)
`EarnerType`, `Earner`, `EarnerSolution`, `PartnerInquiry`, `PartnerApplication`, `PartnerCertificate`, `PartnerSetting`. Defaults (Referral 20%, Reseller 30%, Exclusive 30% starting value, Sales Agent 20%, all lifetime) and the Campusly Solution are written the first time the programme is opened (`ensurePartnerDefaults`) and are then edited in Partner Stack settings.

## Code
`src/lib/partner-stack.ts` (all rules), `partner-certificate-pdf.ts`, `src/app/(site)/partners`, `src/app/(app)/partner-stack`, `src/app/partner`, `src/app/api/partners`. Tests: `partner-stack.test.ts`, `partner-stack.integration.test.ts`.

## Not built yet
Phase 2 partner CRM and dashboard, Phase 3 lead distribution and territories, Phase 4 webhooks and commission engine (the existing first-invoice-only staff commission, PR #81, is untouched), Phase 5 in-house agents on the new engine, Phase 6 targets and competitions.
