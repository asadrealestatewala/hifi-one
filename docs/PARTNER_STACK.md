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

## Partner ID (added 2026-11-14, Asad's request)
Every partner gets a sequential, system-generated Partner ID at approval (`Earner.partnerNumber`, shown as `HPS-0001`), unique per organization and never reused. Approvals take an advisory lock while the next number is picked, so simultaneous approvals cannot collide. It appears on the certificate PDF, the public verify page, the approval email, the partner portal, and the admin Partners and Certificates lists (searchable as `HPS-0012`, `hps-12` or `12`). The referral code (`HP-XXXXXXXX`) stays separate: it is for links and client attribution in Phase 4.

## Certificate designs and LinkedIn (added 2026-11-14, Asad's request)

- Four PDF designs in `src/lib/partner-certificate-pdf.ts`: Classic (the first one), Modern (navy side panel, the default), Academy (round seal and signature line) and Course (paper colour, serif name, ribbon). Same facts on each. Partner Stack → Settings → "Certificate design" picks one for every download, new or already issued; "Open sample PDF" (`/partner-stack/settings/preview/<design>`, `partners.settings`) shows each with example details. Thumbnails are static files in `public/partner-stack/designs/`; regenerate them if a design changes.
- Optional signatory name and title (settings `cert_signatory_name`, `cert_signatory_title`). Empty name prints the company name instead of a signature line; nobody's name is printed unless an admin types it.
- Partner portal, per valid certificate: Download PDF, Download image (PNG 1200 x 627, `/partner/certificates/[id]/image`, own certificates only), "Add to LinkedIn profile" (LinkedIn's add-certification form filled with name, issuer, issue month, certificate ID and verify link; expiry left empty because renewals keep the ID) and "Share on LinkedIn" (shares the verify link).
- The verify page has link-preview tags and an image (`opengraph-image.tsx`), so a shared link shows the certificate as a picture on LinkedIn, WhatsApp and X. Only a valid certificate shows the partner's name; unknown, expired or revoked ones show a plain "Check a certificate" card.
- Optional setting `linkedin_company_id` (the number in the LinkedIn company admin link) makes LinkedIn show the company logo on the partner's profile entry.
- The image uses the Inter font (SIL Open Font License) from `public/partner-stack/fonts/`.
