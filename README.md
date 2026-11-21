# backend-nail-art-app

Backend REST API for **The Nail Palace**, a single-owner nail art studio in Jambi, Indonesia. It serves the service catalog, slot availability, anti-double-booking reservations, admin management, a dashboard, and admin notifications (inbox + Web Push).

Stack: Express 5, TypeScript (strict), Bun (development), Prisma ORM 7 with `@prisma/adapter-pg`, PostgreSQL, zod. Production runs the `tsc` output on Node.js 26.

> [!IMPORTANT]
> Contributor Guide: Before contributing to this project, please read the [![Git Workflow](https://img.shields.io/badge/Contribution-Git_Workflow-blue?logo=git)](./GIT_WORKFLOW.md) to understand our branching strategy, commit conventions, and pull request process.

## Source-of-truth documents

| Document                                                      | Purpose                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`PRD_Backend_The_Nail_Palace.md`](./PRD_Backend_The_Nail_Palace.md) | Requirements (FR-01..FR-17, in Indonesian), architecture, test strategy |
| [`documents/openapi.yaml`](./documents/openapi.yaml)          | API contract. If it conflicts with the PRD, the contract wins           |
| [`GIT_WORKFLOW.md`](./GIT_WORKFLOW.md)                        | Branches, commit convention, PR process                                 |
| [`CLAUDE.md`](./CLAUDE.md)                                    | Architecture, conventions and decisions already made                    |

## Project status

The backend is built module by module (one module = one branch = one PR into `develop`). Prototype demo deadline: **8 December 2026**.

| #   | Module                                                        | Scope                                                                         | Status                        |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| 1   | Core infrastructure                                           | Env validation, `AppError`, request id, logging, `validate()`, health routes  | Done                          |
| 2   | Data model                                                    | All tables, `bookings_no_overlap` EXCLUDE + CHECK constraints, seed          | Done                          |
| 3   | Admin auth (FR-06)                                            | Login, refresh rotation, logout, logout-all, `/auth/me`, HttpOnly cookie      | Done                          |
| 4   | Catalog (FR-01, FR-02, FR-08)                                 | Public services and artists, admin CRUD                                       | Done                          |
| 5   | Schedule management (FR-09)                                   | Business hours (with break), blocked slots, conflict preview                  | Done                          |
| 6   | Availability (FR-03)                                          | `GET /availability` slot calculation                                          | Done                          |
| 7   | Public booking (FR-04, FR-05, FR-11)                          | Create, look up and cancel booking, status history, concurrency safety        | Done                          |
| 8   | Admin booking (FR-07, FR-13)                                  | List/filter, status transitions, reschedule, manual booking, `wa.me` reminder | Done                          |
| 9   | Dashboard (FR-10)                                             | `GET /admin/dashboard/summary`                                                | Done                          |
| 10  | Security hardening (FR-12, FR-14)                             | Rate limits, helmet, CORS allowlist, `trust proxy`, protected `/docs`, contract tests | Done                  |
| 11  | CSV export (FR-15)                                            | `GET /admin/export/bookings.csv` (no personal data)                           | Done (FR-16 risk score not built, waits for PRD question 7) |
| 12a | Notifications (FR-17)                                         | In-app inbox, event notifications, 60 s scheduler                             | Done                          |
| 12b | Web Push (FR-17)                                              | VAPID, push subscriptions, push sender                                        | Done                          |

Still open: services and real business hours are not seeded yet (waiting for the owner's `services.csv` / `jam_operasional.csv`), and deploy location, HTTPS reverse proxy and database backup (PRD section 14) are undecided.

## Features

- **Public**: service and artist catalog, slot availability, create a booking without an account, look up and cancel by booking code + phone (a mismatch returns 404, never 403).
- **No double booking**: enforced in PostgreSQL by an `EXCLUDE USING gist` constraint (`23P01` maps to `409 SLOT_UNAVAILABLE`), plus a `BOOKING_BUFFER_MINUTES` buffer and blocked-slot check under a shared advisory lock.
- **Admin**: JWT auth with rotating refresh tokens, booking management (confirm, complete, cancel, no-show, reschedule, manual booking), catalog CRUD, business hours, blocked slots with conflict preview (`409 BLOCK_HAS_BOOKINGS`), dashboard metrics, CSV export.
- **Notifications**: inbox with per-admin read state, a scheduler for unconfirmed / upcoming / schedule-conflict reminders, and Web Push (enabled only when the VAPID variables are set).
- **Security**: rate limits (login, booking, lookup, whole API), helmet, CORS allowlist, `/docs` protected by Basic auth in production, contract tests against `openapi.yaml`.

## Endpoints

Everything is mounted at `/api/v1`; `/health/live` and `/health/ready` sit outside it. The full contract is in [`documents/openapi.yaml`](./documents/openapi.yaml), and Swagger UI is served at `/docs` (open outside production; in production only when `DOCS_PASSWORD` is set).

| Area          | Endpoints                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Public        | `GET /services`, `GET /services/{id}`, `GET /artists`, `GET /availability`, `POST /bookings`, `GET /bookings/{booking_code}`, `POST /bookings/{booking_code}/cancel` |
| Auth          | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `GET /auth/me`                                |
| Admin booking | `GET/POST /admin/bookings`, `GET/PATCH /admin/bookings/{id}`, `PATCH /admin/bookings/{id}/status`                      |
| Admin catalog | `/admin/services[/{id}]`, `/admin/artists[/{id}]`                                                                      |
| Admin schedule | `GET/PUT /admin/business-hours`, `GET/POST /admin/blocked-slots`, `POST /admin/blocked-slots/check`, `DELETE /admin/blocked-slots/{id}` |
| Dashboard / export | `GET /admin/dashboard/summary`, `GET /admin/export/bookings.csv` (owner only)                                     |
| Notifications | `GET /admin/notifications`, `/unread-count`, `POST /read-all`, `POST /{id}/read`                                       |
| Web Push      | `GET /admin/push/public-key`, `/admin/push-subscriptions`                                                              |

## Getting started

```bash
bun install
cp .env.example .env       # set DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (>= 32 chars)
bun run prisma:generate    # required after install and schema changes
bun run db:migrate:deploy  # apply migrations
bun run db:seed            # idempotent: one artist, closed business hours, owner admin (ADMIN_SEED_*)
bun run dev                # Bun runs TypeScript directly
```


Production-style build (transpile with `tsc`, run on Node.js 26):

```bash
bun run build
bun run start
```

Running with Docker / Podman Compose (app + PostgreSQL):

```bash
docker compose -f compose.dev.yaml up -d --build
```

### Environment variables

All variables are documented in [`.env.example`](./.env.example). The server refuses to start without `DATABASE_URL`, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. Groups:

- Database and server: `DATABASE_URL`, `POSTGRES_*`, `NODE_ENV`, `PORT`, `TZ`, `LOG_LEVEL`, `TRUST_PROXY`
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `AUTH_COOKIE_SAMESITE`, `CORS_ORIGINS`
- Booking rules: `SLOT_STEP_MINUTES`, `BOOKING_BUFFER_MINUTES`, `MAX_ADVANCE_DAYS`, `CANCEL_MIN_HOURS_BEFORE`
- Rate limits and docs: `RATE_LIMIT_*_MAX`, `DOCS_USER`, `DOCS_PASSWORD`
- Notifications and Web Push: `NOTIFY_UNCONFIRMED_AFTER_MINUTES`, `NOTIFY_UPCOMING_MINUTES_BEFORE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (all three or none; generate with `bunx web-push generate-vapid-keys`)
- Seed: `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` (>= 12 chars)

## Scripts

| Command                       | Description                                                         |
| ----------------------------- | ------------------------------------------------------------------- |
| `bun run dev`                 | Start with hot reload                                               |
| `bun run build` / `start`     | Compile to `dist/` / run on Node                                    |
| `bun run lint`                | ESLint (also enforces layer boundaries)                             |
| `bun run format[:check]`      | Prettier                                                            |
| `bun run typecheck`           | `tsc --noEmit`                                                      |
| `bun run test:unit`           | Unit tests with coverage (mocked repositories)                      |
| `bun run db:test:reset`       | Recreate the `*_test` database from migrations (`DATABASE_URL_TEST`) |
| `bun run test:integration`    | HTTP + database tests (DB suites skip without `DATABASE_URL_TEST`)  |
| `bun run test`                | Unit then integration, in separate processes                        |
| `bun run verify`              | Format check + lint + typecheck + unit tests + build                |
| `bun run db:seed`            | Idempotent seed (owner admin, artist, closed hours)                 |

## Release

`scripts/release.sh` is the only supported release path: integration tests in the dev container, then `Dockerfile.prod` (lint, typecheck, unit tests, build and a Node smoke test run in its `verify` stage), then `compose.prod.yaml`. Production secrets go in `.env.prod` (not committed). Production assumes one HTTPS reverse proxy in front of the container (`TRUST_PROXY` defaults to 1).

## Architecture

Layered: `routes → controllers → services → repositories → PostgreSQL`. Upper layers call lower ones only, and only `repositories/` (and `utils/prisma.ts`) imports Prisma Client; ESLint enforces this. Errors are thrown as `AppError` and returned as `{ error: { code, message, details } }`. Timestamps are `timestamptz` in the database and ISO 8601 with `+07:00` in the API; money is an integer in Rupiah.

## Project Directory

```bash
backend-nail-art-app/
│
├── bun.lock                     # Bun dependency lockfile
├── bunfig.toml                  # Bun test runner settings
├── compose.dev.yaml             # Docker/Podman Compose for development (app + PostgreSQL)
├── compose.prod.yaml            # Compose for production (db, migrate, api)
├── Dockerfile.dev               # Development image (Bun, hot reload)
├── Dockerfile.prod              # Multi-stage production image (tsc build, Node.js 26)
├── documents/
│   └── openapi.yaml             # API contract (source of truth)
├── eslint.config.mjs            # ESLint config incl. layer boundaries and Bun-API ban
├── package.json                 # Dependencies and scripts
├── prisma/                      # Prisma ORM schema and migrations
│   ├── migrations/
│   ├── schema.prisma
│   ├── seed.ts                  # Idempotent seed (admin, artist, closed business hours)
├── prisma.config.ts             # Prisma 7 configuration (schema, migrations, datasource)
├── PRD_Backend_The_Nail_Palace.md  # Product requirements
├── scripts/
│   ├── db-init.sh               # Creates the *_test database on first start
│   ├── dev-entrypoint.sh        # Dev container entrypoint (generate, migrate, watch)
│   └── release.sh               # Release gate: tests, build images, start production
├── src/
│   ├── app.ts                   # Builds the Express app (no listen, easy to test)
│   ├── server.ts                # Entry point: listen, schedulers, graceful shutdown
│   ├── config/env.ts            # Environment validation (fail-fast)
│   ├── controllers/             # Handle HTTP requests and responses
│   ├── jobs/                    # Background jobs: notification scheduler, Web Push sender
│   ├── middleware/              # Request id, logging, auth, rate limits, validation, errors
│   ├── repositories/            # Database access (only layer that imports Prisma)
│   ├── routes/                  # Endpoint definitions (mounted at /api/v1, plus /health)
│   ├── schemas/                 # zod request schemas
│   ├── scripts/smoke.ts         # Node smoke test run against the compiled build
│   ├── services/                # Business logic
│   ├── types/                   # Shared types
│   └── utils/                   # Helpers (errors, tokens, password, datetime, whatsapp, ...)
├── tests/                       # unit/ (mocked repositories) and integration/ (HTTP, DB, contract)
├── tsconfig.build.json          # Production build (src only, emits to dist/)
└── tsconfig.json                # Editor/typecheck config
```

## Dependencies

| Package               | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `@node-rs/argon2`     | argon2id password hashing.                                 |
| `@prisma/adapter-pg`  | PostgreSQL driver adapter for Prisma ORM.                  |
| `@prisma/client`      | Prisma Client for database queries and operations.         |
| `cors`                | CORS allowlist.                                            |
| `dotenv`              | Loads environment variables from `.env` files.             |
| `express`             | Web framework for building REST APIs.                      |
| `express-rate-limit`  | Rate limiting (login, booking, lookup, whole API).         |
| `helmet`              | Secure HTTP headers.                                       |
| `jose`                | JWT signing and verification.                              |
| `pg`                  | PostgreSQL client for Node.js.                             |
| `pino`, `pino-http`   | Structured logging (secrets and phones redacted).          |
| `swagger-ui-dist`     | Swagger UI served locally at `/docs`.                      |
| `web-push`            | Web Push sender (VAPID).                                   |
| `zod`                 | TypeScript-first schema validation library.                |

## Development Dependencies

| Package                                   | Description                                            |
| ----------------------------------------- | ------------------------------------------------------ |
| `@eslint/js`, `eslint`, `typescript-eslint` | Linting, including layer-boundary rules.             |
| `prettier`                                | Code formatting.                                       |
| `@types/*`                                | Type definitions (bun, cors, express, node, pg, ...).  |
| `ajv`, `ajv-formats`, `yaml`              | Contract tests against `openapi.yaml`.                 |
| `prisma`                                  | Prisma CLI for schema management and migrations.       |
| `typescript`                              | TypeScript compiler.                                   |

This project was created using `bun init` in bun v1.4.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
