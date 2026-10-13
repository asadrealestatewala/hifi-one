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

Dark sidebar with module groups (dropdowns, a coloured icon chip per module, count badges for what waits for you), and a top bar (search, Create, theme, notifications). Navigation lives only in the sidebar: the pill tab strip that repeated it at the top and the level card at the bottom of the sidebar were removed at the owner's request. Level and daily goals remain on the dashboard. A thin progress bar runs across the top while a page loads. Module colours: `src/components/shell/nav-colors.ts`.

Interactivity: pages fade in on navigation; link cards and stat tiles lift on hover; a click anywhere on a table row opens its record (`RowClick`, only when the click is not on a control or a text selection; the real link stays for keyboard users); menu items nudge on hover; reduced-motion settings switch the motion off.

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
- Every list has empty, loading (`loading.tsx` skeleton) and error states.
- Colour is never the only signal: statuses carry a text label; progress bars carry `role="progressbar"`.
- Touch targets and keyboard: all controls are real buttons or links; panels close with Escape.

## Approved deviations from the original reference

The owner asked for a "sleek, modern, interactive, gamified" interface after the first version. Approved and implemented: module-coloured icon chips, slide-over panels, dashboard goals card, small gradients on progress bars. Gradients are not used elsewhere. See `docs/DECISIONS.md`.
