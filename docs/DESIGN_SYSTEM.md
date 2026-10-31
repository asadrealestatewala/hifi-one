# Design system (locked)

Source of truth for colours is `src/app/globals.css` (light default, dark by choice or system setting). Do not change tokens, fonts or the shell structure without recording the decision in `docs/DECISIONS.md` and updating this file.

## Tokens

| Token | Light | Use |
|---|---|---|
| `--primary` | #5648e8 | Buttons, links, active chips, progress |
| `--accent` | #a89cff | Highlights on the dark sidebar |
| `--sidebar` | #0f1230 | Dark navy sidebar |
| `--brand` | #e11d1d | The logo red, also errors and alerts |
| `--success` / `--warning` | #15803d / #b45309 | Status |
| `--background` / `--surface` / `--hover` / `--border` / `--muted` | #f6f7fb / #fff / #f0f1f8 / #e5e7f0 / #6b7189 | Workspace |

Classes `btn`, `btn-ghost`, `input`, `label`, `card` and `skeleton` are defined in `globals.css`. Animations: `slidein`, `fade`, `pop`, `confetti`, `shimmer`.

## Shell

Dark sidebar with module groups (dropdowns, a coloured icon chip per module, count badges for what waits for you) and, at the bottom, the signed-in person: picture, name, role, an account menu (My profile, two-step verification, change password, calendar feed, notifications) and a sign-out button. The top bar has only search, Create, theme and notifications. Navigation lives only in the sidebar: the pill tab strip that repeated it at the top and the level card at the bottom of the sidebar were removed at the owner's request. Level and daily goals remain on the dashboard. A thin progress bar runs across the top while a page loads. Module colours: `src/components/shell/nav-colors.ts`.

Interactivity: pages fade in on navigation; link cards and stat tiles lift on hover; a click anywhere on a table row opens its record (`RowClick`, only when the click is not on a control or a text selection; the real link stays for keyboard users); menu items nudge on hover; reduced-motion settings switch the motion off.

The dashboard hero uses the primary colour with a soft gradient (owner asked for a sample-style hero); a small floating Ask button sits bottom-right on every screen where the assistant is allowed.

## Shared components (use these, do not copy markup)

`src/components/ui.tsx`: `PageHeader`, `Stat` (KPI card), `Badge`, `StatusBadge`, `Progress`, `Empty`, `Notice`, `Chips` (filter links with counts), `SearchBox`, `NewButton`, `ExportLink` ("Export CSV" link to a list's export route), `Pager`, `SortTh`, `Avatar`, `PanelForm` (body of a slide-over form; its Save button is a `SubmitButton`), `likeEscape`.
`src/components/ui/SubmitButton.tsx` (pending "Saving…" state via `useFormStatus`, no double submit; also used by `FilesPanel` and `PhotoForm`), `ConfirmButton.tsx`, `ErrorView.tsx` (used by every `error.tsx`), `NotFoundView.tsx` (used by every `not-found.tsx`), `PageSkeleton.tsx` (`list` or `board` skeleton for section `loading.tsx`).
`src/components/ui/Drawer.tsx`: slide-over panel (Escape or backdrop closes). `src/components/ui/LineItems.tsx`: invoice and quote lines with live totals.
Contacts: `EditableSection` (pencil turns a block into a form that saves alone), `Editors` (phone/email rows, custom fields, shipping with copy-billing).

## List screen pattern

`PageHeader` (title, one-line purpose, primary action) → `Stat` strip → search plus `Chips` status filters (state in the URL) → table in `card !p-0` with tinted header and row hover → "New …" opens a `Drawer` via `?new=1`. Pager under the table ("x–y of N"), sortable headers with `SortTh`, and `ExportLink` in the header.

List engine (no client-side table component): `src/lib/list-params.ts` parses `q`, `sort`/`dir` (whitelisted per list), `page`, `status` (whitelisted), `from`/`to` and id filters with zod and falls back to defaults on bad input; `listHref` builds links that keep the other filters. `src/lib/lists.ts` holds each list's filter builder (`invoiceWhere`, `paymentWhere`, `leadWhere`, `quoteWhere`, `expenseWhere`, `auditWhere`), which checks the list's permission and applies record scope, so the page, its counts and its CSV export cover the same rows. `listExport` + `csvResponse` stream every matching row in batches of 1,000 (no page cap), with formula characters defused (`csvCell`), amounts as exact two-decimal strings beside a currency column, and no sensitive fields. A refused save redirects back with `?new=1&error=…` so the panel reopens with the message.

## Detail screen pattern

Back link, header with status badge, the key number (balance, term, stage) and primary actions, then sections. Destructive or rare actions sit behind a disclosure.

## Rules

- Sizes, radii and spacing come from the existing classes; no per-page overrides. Tables scroll horizontally inside their card, never the page.
- Every list has empty, loading (`loading.tsx` skeleton) and error states. `error.tsx` and `not-found.tsx` exist in `(app)`, `portal` and `vendor` (plus the root `not-found.tsx`); `loading.tsx` exists in `(app)` (generic) and in `finance`, `hr`, `leads`, `contacts` (list skeleton) and `pipeline` (board skeleton).
- Colour is never the only signal: statuses carry a text label; progress bars carry `role="progressbar"`.
- Touch targets and keyboard: all controls are real buttons or links; panels close with Escape.

## Approved deviations from the original reference

The owner asked for a "sleek, modern, interactive, gamified" interface after the first version. Approved and implemented: module-coloured icon chips, slide-over panels, dashboard goals card, small gradients on progress bars. Gradients are not used elsewhere. See `docs/DECISIONS.md`.

## Adoption (measured 2026-10-13)

The kit above is correct but under-used, which is the main reason screens drift (`docs/REFERENCE_ERP_AUDIT.md`, RC1):
28 of 102 pages used `PageHeader` (73 wrote their own `<h1>`); 53 files hand-wrote `<table>` markup; 64 files inlined an error `<p role="alert">` instead of `Notice`. Since then the expenses, audit log and commissions pages moved onto the kit, and `Pager`, `SubmitButton`, `ConfirmButton` and `ErrorView` were added.

When you touch a page, bring it onto the kit: `PageHeader`, `Notice`, `Empty`, `StatusBadge`, `Stat`, `Chips`, `SearchBox`, `Drawer` + `PanelForm`. Do not restyle a page with one-off classes.

## Downloads, tabs and notices (2026-10-14)

`DownloadButtons` puts CSV and PDF links on a report (`/reports/download`). Detail pages with several concerns use `Chips` as tabs (`?tab=` in the address; each tab loads only its own data): My Profile, customer, vendor. Errors and confirmations use `Notice`; as of this date 32 page headers use `PageHeader` and 59 inline alert boxes were moved to `Notice`; about 40 pages still write their own header (those with actions or custom titles).

## Clickable figures

`Stat` takes `href`: the whole card becomes a link with an arrow, and must open the filtered list behind the number. Dashboard `Bars` rows take `href` the same way. Destination lists show `AppliedFilters` (removable filter pills and a back link) and accept `from=dashboard` / `src=dashboard`. `DateRangeForm` adds from/to dates to a list. Leave `href` off when the person cannot open the destination.

## Interaction standards (benchmark: Agentify ERP, adapted to server components)

These are the standards new and touched screens must meet. Components marked *planned* do not exist yet; build them once in `src/components/ui.tsx` (or `src/components/ui/`) and reuse them, never per page.

| Situation | Standard | Component |
|---|---|---|
| Page title | Title, one-line purpose, primary action on the right | `PageHeader` |
| Card with a heading | Title row with optional actions, then body | `Card` *(planned)* |
| Form field | Label (with `htmlFor`), required mark, hint, error under the field | `Field` *(planned)*; today `label` class + `htmlFor` |
| Submit | Button disables and says "Saving…" while pending; no double submit | `SubmitButton` (`src/components/ui/SubmitButton.tsx`; built into `PanelForm`) |
| Destructive or financial action (cancel, void, write off, reverse, reject, delete) | Confirmation dialog inside the action's form; `reason` adds a required reason field, read on the server with `readReason` (`src/lib/reasons.ts`) and kept in the audit log | `ConfirmButton` (`src/components/ui/ConfirmButton.tsx`) |
| Result of an action | Error: `Notice kind="error"` at the top of the form or page; success: a short `Notice kind="ok"` or flash | `Notice` |
| List | Search, status chips, pagination with "x–y of N" (50 per page, `?page=` in the address), empty state with next step, export where the role may export | `parseListParams` (`src/lib/list-params.ts`) and the builders in `src/lib/lists.ts`, `Pager` at the bottom of the `card !p-0` table, `SortTh`, `ExportLink` to `<list>/export` |
| Key/value detail | Two-column definition list | `KV` *(planned)* |
| Money | Tabular figures, currency always shown | `formatMoney` (`src/lib/money.ts`) |
| Date ranges | Presets (this month, last month, quarter, year, custom) | the dashboard period picker; generalise to `DateRange` *(planned)* |
| Status | One tone map for all statuses (`STATUS_TONE`); colour plus text | `StatusBadge` |
| Loading | Skeleton matching the layout, per route segment | `loading.tsx` with `PageSkeleton` (`.skeleton`) |
| Errors | Friendly message, retry, link home, reference code; never the error text | `ErrorView` via `error.tsx` in `(app)`, `portal`, `vendor`; `NotFoundView` via `not-found.tsx` in the same three areas, plus the root |
| Dialogs and panels | Escape closes, focus moves into the panel, close button labelled | `Drawer` (focus handling to add) |

Added 2026-10-17: `SortTh` (sortable table header with `aria-sort`, address-driven, `src/lib/sort.ts`), `SavedViews` (personal saved filters on a list), `CommandPalette` (Ctrl K, in the shell), `ProjectTimeline` (Gantt bars with text alternatives). The `SIGNED` status uses the success tone.

Tokens stay as listed at the top (brand red, violet primary, navy sidebar). If a tone is missing (for example an info blue or tinted backgrounds for status), add a token to `globals.css` and record it in `docs/DECISIONS.md`; do not adopt the reference's teal palette or font.
