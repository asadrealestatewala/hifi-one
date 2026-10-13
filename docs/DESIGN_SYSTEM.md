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

`src/components/ui.tsx`: `PageHeader`, `Stat` (KPI card), `Badge`, `StatusBadge`, `Progress`, `Empty`, `Notice`, `Chips` (filter links with counts), `SearchBox`, `NewButton`, `Avatar`, `PanelForm` (body of a slide-over form), `likeEscape`.
`src/components/ui/Drawer.tsx`: slide-over panel (Escape or backdrop closes). `src/components/ui/LineItems.tsx`: invoice and quote lines with live totals.
Contacts: `EditableSection` (pencil turns a block into a form that saves alone), `Editors` (phone/email rows, custom fields, shipping with copy-billing).

## List screen pattern

`PageHeader` (title, one-line purpose, primary action) → `Stat` strip → search plus `Chips` status filters (state in the URL) → table in `card !p-0` with tinted header and row hover → "New …" opens a `Drawer` via `?new=1`. A refused save redirects back with `?new=1&error=…` so the panel reopens with the message.

## Detail screen pattern

Back link, header with status badge, the key number (balance, term, stage) and primary actions, then sections. Destructive or rare actions sit behind a disclosure.

## Rules

- Sizes, radii and spacing come from the existing classes; no per-page overrides. Tables scroll horizontally inside their card, never the page.
- Every list has empty, loading (`loading.tsx` skeleton) and error states. (Target, not yet met: today there is one `src/app/(app)/loading.tsx` and no `error.tsx`; see "Adoption" below.)
- Colour is never the only signal: statuses carry a text label; progress bars carry `role="progressbar"`.
- Touch targets and keyboard: all controls are real buttons or links; panels close with Escape.

## Approved deviations from the original reference

The owner asked for a "sleek, modern, interactive, gamified" interface after the first version. Approved and implemented: module-coloured icon chips, slide-over panels, dashboard goals card, small gradients on progress bars. Gradients are not used elsewhere. See `docs/DECISIONS.md`.

## Adoption (measured 2026-10-13)

The kit above is correct but under-used, which is the main reason screens drift (`docs/REFERENCE_ERP_AUDIT.md`, RC1):
28 of 102 pages use `PageHeader` (73 write their own `<h1>`); 53 files hand-write `<table>` markup; 64 files inline an error `<p role="alert">` instead of `Notice`; one `loading.tsx`, no `error.tsx` or `not-found.tsx`; `PanelForm`'s submit button has no pending state; there is no confirmation component.

When you touch a page, bring it onto the kit: `PageHeader`, `Notice`, `Empty`, `StatusBadge`, `Stat`, `Chips`, `SearchBox`, `Drawer` + `PanelForm`. Do not restyle a page with one-off classes.

## Interaction standards (benchmark: Agentify ERP, adapted to server components)

These are the standards new and touched screens must meet. Components marked *planned* do not exist yet; build them once in `src/components/ui.tsx` (or `src/components/ui/`) and reuse them, never per page.

| Situation | Standard | Component |
|---|---|---|
| Page title | Title, one-line purpose, primary action on the right | `PageHeader` |
| Card with a heading | Title row with optional actions, then body | `Card` *(planned)* |
| Form field | Label (with `htmlFor`), required mark, hint, error under the field | `Field` *(planned)*; today `label` class + `htmlFor` |
| Submit | Button disables and says "Saving…" while pending; no double submit | `SubmitButton` *(planned, `useFormStatus`)* |
| Destructive or financial action (cancel, void, write off, reverse, reject, delete) | Confirmation step, and a reason when the service records one | `ConfirmButton` *(planned)* |
| Result of an action | Error: `Notice kind="error"` at the top of the form or page; success: a short `Notice kind="ok"` or flash | `Notice` |
| List | Search, status chips, sortable headers, pagination with "x–y of N", empty state with next step, export where the role may export | `DataTable` *(planned, URL-driven)*; today `card !p-0` table pattern |
| Key/value detail | Two-column definition list | `KV` *(planned)* |
| Money | Tabular figures, currency always shown | `formatMoney` (`src/lib/money.ts`) |
| Date ranges | Presets (this month, last month, quarter, year, custom) | the dashboard period picker; generalise to `DateRange` *(planned)* |
| Status | One tone map for all statuses (`STATUS_TONE`); colour plus text | `StatusBadge` |
| Loading | Skeleton matching the layout, per route segment | `loading.tsx` with `.skeleton` |
| Errors | Friendly message, retry, link home; never a stack trace | `error.tsx` per area *(planned)* |
| Dialogs and panels | Escape closes, focus moves into the panel, close button labelled | `Drawer` (focus handling to add) |

Tokens stay as listed at the top (brand red, violet primary, navy sidebar). If a tone is missing (for example an info blue or tinted backgrounds for status), add a token to `globals.css` and record it in `docs/DECISIONS.md`; do not adopt the reference's teal palette or font.
