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

## Training and certificate of authorisations (2026-11-14, Asad's decision)

- Two kinds (`PartnerCertificate.kind`, migration `20261114020000_partner_certificate_kind`): **TRAINING** in the Course design (cream paper, serif name, ribbon), never expires, cannot be renewed; **AUTHORISATION** (the certificate of authorisation) in the Academy design (round seal, signature line), expires and is renewed. The Modern and Classic designs were dropped.
- Training comes first: `issueCertificate` refuses a certificate of authorisation for a Solution without a valid training certificate for it. At approval the column "Training done" issues training certificates; the official one is issued from the partner's page.
- Expiry reminders cover certificate of authorisations only. The verify page, portal, emails (`{{certificate}}` variable), LinkedIn name and social image all say which kind it is.
- Optional signatory name and title (settings `cert_signatory_name`, `cert_signatory_title`); empty prints the company name. Sample PDFs: `/partner-stack/settings/preview/training|authorisation`.
- Partner portal, per valid certificate: Download PDF, Download image (PNG 1200 x 627, `/partner/certificates/[id]/image`, own certificates only), "Add to LinkedIn profile" (expiry left empty because renewals keep the ID) and "Share on LinkedIn" (shares the verify link).
- The verify page has link-preview tags and an image (`opengraph-image.tsx`); only a valid certificate shows the partner's name. Optional setting `linkedin_company_id` makes LinkedIn show the company logo. The image uses Inter (SIL Open Font License) from `public/partner-stack/fonts/`.
- Next (planned, not built): the Partner Academy, where training videos issue the training certificate and a passed test issues the official one automatically.

## Partner Academy, step 1 (2026-11-14, Asad's "build it")

Plan: "Hifi Partner Academy: training, test and certificates" (https://claude.ai/artifact/NR5SxX77j69bWqLfkXaq6X). Step 1 is built; step 2 (final test, automatic certificate of authorisation, Student type, direct access for Exclusive partners) and step 3 (renewal refresher, reports) are not.

- **Staff:** Partner Stack → Academy tab (`/partner-stack/academy`, permission `partners.manage`). One foundations course (every partner) and one course per Solution. A course page lists lessons; a lesson page holds the video link (YouTube, unlisted is fine; Vimeo including unlisted hash links; or a direct https .mp4), length, the script (staff only), notes shown to partners, quick-check size (3 or 5) and the question bank. Partner progress per course sits under the courses.
- **Questions:** typed in, imported (paste rows from Google Sheets/Excel or a .csv: Question, A, B, C, D, Correct letter(s), Why; all or nothing), or drafted by Claude from the saved script (needs the Anthropic key in Settings → Integrations, else "not configured"; model `claude-opus-5-5`, override with `ACADEMY_MODEL`). Every new question is a draft; partners only ever see published ones. Published questions are retired, never edited or deleted, so past attempts keep what they were graded on.
- **Publishing rules:** a lesson publishes only with at least its quick-check size of published questions (about 10 recommended); a course publishes only with a published lesson; retiring cannot drop a published lesson below its quick-check size. A lesson nobody has started can be deleted.
- **Partners:** `/partner/academy` (Academy link in the portal header). Foundations first, then the courses of the Solutions they are approved for. Lessons open one after another. Watching to 90% (counted from seconds actually played, kept in the browser between visits) or "Mark as read" for a notes-only lesson opens the quick check: questions drawn at random from the bank, the same set if the page is reloaded within 30 minutes, one wrong answer allowed, missed questions shown with the "Why" (never the right option), retake draws a fresh set. "What's new" lessons have no quick check and are not needed for the certificate.
- **Certificate:** finishing the foundations course and a Solution's course issues that Solution's training certificate automatically (no issuer, emailed as usual) and notifies people with `partners.manage`. Never twice while one is live.
- **Honest limits:** watch progress is reported by the partner's browser, so it is a guide; the quick checks (and the final test in step 2) are the real check. The video preview needs YouTube/Vimeo reachable from the browser.
- **Data:** migration `20261114030000_partner_academy` (additive): `AcademyCourse`, `AcademyLesson`, `AcademyQuestion`, `AcademyLessonProgress`, `AcademyQuizAttempt`. Code: `src/lib/partner-academy.ts` (+ `.test.ts`, `.integration.test.ts`), `src/app/(app)/partner-stack/academy/`, `src/app/partner/academy/`.
