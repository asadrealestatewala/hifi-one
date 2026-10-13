---
paths:
  - "src/app/**/*.tsx"
  - "src/components/**/*.tsx"
  - "src/app/globals.css"
---

# UI consistency

Full reference: `docs/DESIGN_SYSTEM.md` (tokens, shell, list and detail patterns, interaction standards).

- Compose screens from `src/components/ui.tsx` and `src/components/ui/`. Before writing markup, check whether `PageHeader`, `Stat`, `Chips`, `SearchBox`, `Empty`, `Notice`, `StatusBadge`, `Drawer`, `PanelForm`, `LineItems` or `Avatar` already covers it. If a needed piece is missing (`Card`, `Field`, `SubmitButton`, `ConfirmButton`, `DataTable`, `KV`, `DateRange`), add it once to the kit, then use it.
- Every page starts with `PageHeader`. Errors use `Notice kind="error"`, not a hand-styled `<p>`. Statuses use `StatusBadge` and its single tone map.
- Colours come from the tokens in `globals.css` only. No hex values, no new palettes, no gradients outside the approved places. A new token needs a `docs/DECISIONS.md` entry.
- Lists: search and status chips in the URL, table inside `card !p-0`, empty state that says what to do next, "New" opens a `Drawer` via `?new=1`. Never cap a list with `take:` without pagination and a visible "x–y of N".
- KPI cards and dashboard numbers come from aggregates or the shared loaders, never from a capped list.
- Destructive or financial buttons (cancel, void, write off, reverse, reject, delete) need a confirmation step; submit buttons show a pending state.
- Each route area that loads data has a `loading.tsx`; each portal area needs an `error.tsx`.
- Accessibility: real buttons and links, `htmlFor` on labels, `aria-label` on icon-only buttons, Escape closes panels, colour is never the only signal, `role="progressbar"` on bars, reduced motion respected.
- Responsive: works from 360 px wide; tables scroll inside their card, never the page.
- Keep Hifi One's brand (red logo, violet primary, navy sidebar). The reference ERP is a benchmark for polish only; do not copy its palette, font or markup.
