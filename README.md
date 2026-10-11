# Hifi One

Unified ERP for **Hifi Marketing and Technologies**. Full requirements: [docs/spec.md](docs/spec.md).
Build status: [docs/roadmap.md](docs/roadmap.md) · What is and is not built against the spec: [docs/GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md)
Deploying: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · Security: [docs/SECURITY.md](docs/SECURITY.md) · Roles: [docs/ROLES.md](docs/ROLES.md)

## Stack

Next.js 15 (App Router) + TypeScript + Tailwind, PostgreSQL via Prisma, session-cookie auth with
database-backed sessions, permission-based access control, audit log.

## Run locally

Requires Node 20+. No Docker or separate Postgres install needed; a local PostgreSQL runs from the npm package.

```bash
npm install --legacy-peer-deps   # legacy flag needed because of a peer-dependency conflict in the test tooling
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
| `npm test` | All tests (the integration tests need the local database running; they use a separate `hifi_one_test` database) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run db:start` | Local PostgreSQL |
| `npm run db:seed` | Seed demo data (development only; refuses to run in production) |
| `npm run db:backup` / `db:restore` | Back up or restore the local development database (stop it first) |
| `npm run docs:roles` | Regenerate `docs/ROLES.md` from the permission definitions |
| `npm run build` / `npm run start` | Production build and server |

## Layout

```
prisma/        schema, migrations, seed
src/app/       pages (login, dashboard, settings, users, audit logs)
src/lib/       db client, auth, permissions, helpers
docs/          spec, roadmap, notes
scripts/       local database runner
public/        logo
```
