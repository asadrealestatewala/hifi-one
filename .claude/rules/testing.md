---
paths:
  - "src/**/*.test.ts"
  - "src/lib/**/*.ts"
  - "vitest.config.ts"
---

# Testing

- Pure rules go in `*.test.ts`; anything touching the database goes in `*.integration.test.ts` against `hifi_one_test` (never point `TEST_DATABASE_URL` at real data; these tests TRUNCATE their tables).
- Every business rule gets a test, including a denied-access case and, for money, a check that debits equal credits.
- When a change crosses modules (for example payment → invoice balance → commission → statement), test the whole chain once and assert the invariants: trial balance balances; receivable equals open invoice balances; one commission per allocation; idempotent retries post once.
- `src/lib/guards.test.ts` must stay green: every page and action calls a guard. Do not add a page to its allow-lists without a reason in the commit.
- Run after each batch: `npx tsc --noEmit`, `npx eslint src`, focused `npx vitest run <file>`. At checkpoints: the whole suite and `npm run build`.
- Report test results honestly with counts; never claim a screen works if it was only type-checked. Say "not checked in a browser" when that is the case.
