# Hifi One

Unified ERP for **Hifi Marketing and Technologies**. Full requirements: [docs/spec.md](docs/spec.md).
Build status and next steps: [docs/roadmap.md](docs/roadmap.md).

## Stack

Next.js 15 (App Router) + TypeScript + Tailwind, PostgreSQL via Prisma, session-cookie auth with
database-backed sessions, permission-based access control, audit log.

## Run locally

Requires Node 20+. No Docker or separate Postgres install needed; a local PostgreSQL runs from the npm package.

```bash
npm install --legacy-peer-deps
npm run db:start        # terminal 1: local PostgreSQL on port 54329 (leave running)
npx prisma migrate dev  # terminal 2: create tables
npm run db:seed         # demo org, roles, demo users (passwords saved to .data/dev-credentials.txt)
npm run dev             # app at http://localhost:3000
```

`.env` is created from `.env.example` (placeholders only). Never commit `.env`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the app on localhost |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run db:start` | Local PostgreSQL |
| `npm run db:seed` | Seed demo data (development only) |

## Layout

```
prisma/        schema, migrations, seed
src/app/       pages (login, dashboard, settings, users, audit logs)
src/lib/       db client, auth, permissions, helpers
docs/          spec, roadmap, notes
scripts/       local database runner
public/        logo
```
