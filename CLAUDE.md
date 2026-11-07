# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Backend REST API for **The Nail Palace**, a single-owner nail art studio in Jambi, Indonesia. It handles service catalog, slot availability, anti-double-booking reservations, admin management, and a dashboard. Stack: Express 5, TypeScript (strict), Bun (dev), Prisma ORM 7 + `@prisma/adapter-pg`, PostgreSQL, zod.

Source-of-truth documents (the PRD is written in Indonesian):
- `PRD_Backend_The_Nail_Palace.md` — requirements (FR-01..FR-16), target architecture, container/release design, env vars, test strategy.
- `documents/openapi.yaml` — API contract. **If the PRD and openapi.yaml conflict, openapi.yaml wins** and the PRD gets updated. Update the contract first when changing an endpoint.
- `GIT_WORKFLOW.md` — branch from `develop` (`feature/`, `fix/`, ...), commit message convention, PR process. Read before committing.

## Commands

```bash
bun install
bun run dev              # bun --watch src/server.ts (Bun runs TS directly)
bun run build            # tsc -p tsconfig.build.json -> dist/
bun run start            # node dist/server.js (production runtime is Node 26)
bun run lint             # eslint .
bun run typecheck        # tsc --noEmit
bun run test:unit        # bun test tests/unit --coverage
bun run db:test:reset    # recreate the *_test database from migrations (uses DATABASE_URL_TEST)
bun run test:integration # data-model tests need DATABASE_URL_TEST and skip without it
bun run verify           # lint + typecheck + unit tests + build
bun run prisma:generate  # required after install/schema changes; output is gitignored
bun --bun run prisma migrate dev
node dist/scripts/smoke.js   # Node smoke test of the compiled build
docker compose -f compose.dev.yaml up -d --build   # app + postgres (podman compose also works)
scripts/release.sh       # only supported release path (integration tests -> prod image build -> compose.prod.yaml)
```

Single test: `bun test path/to/file.test.ts`. `tests/unit` mocks repositories (`mock.module`); `tests/integration/http.test.ts` runs the app over HTTP and needs no database.

Env: copy `.env.example` to `.env` (all PRD variables are listed there). `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (>= 32 chars) and `DATABASE_URL` are required; the server refuses to start without them. Compose builds the container `DATABASE_URL` from `POSTGRES_*`; Prisma CLI on the host needs `DATABASE_URL` in `.env` (read by `prisma.config.ts`). Production secrets go in `.env.prod` (gitignored).

## Architecture

Layered: `routes → controller → services → repositories → PostgreSQL`. Upper layers call lower ones only; the PRD requires that **only `repositories/` imports Prisma Client** (intended to be enforced via ESLint). ESLint enforces this (layer imports, Prisma only in `repositories/` and `utils/prisma.ts`, no Bun APIs in `src/`). `src/app.ts` builds the Express app and `src/server.ts` listens (with graceful shutdown); routes mount at `/api/v1` plus `/health/live`. Shared infrastructure already exists: `config/env.ts` (zod; `getEnv()` memoizes and `server.ts` exits on invalid config, while `app.ts` never calls it so tests and the smoke test import without env), `utils/errors.ts` (`AppError` + factories), `utils/response.ts` (`ok`/`paginated`), `utils/logger.ts` (pino, redacts secrets and phones), `utils/prisma.ts` (lazy singleton `getPrisma()`), and middleware for request-id, http logging, `validate()` (parsed input is read with `getValidated(res)`, since Express 5 `req.query` is read-only), not-found and the error handler. Feature routers mount on the `v1` router in `routes/index.ts`; `/health/live` and `/health/ready` (DB ping) sit outside `/api/v1`. Malformed JSON is mapped to 422 `VALIDATION_ERROR`.

Prisma specifics (v7):
- Config lives in `prisma.config.ts`; the datasource URL is set there, not in `schema.prisma`.
- Client is generated to `src/generated/prisma` (generator `prisma-client`, ESM with `.js` import extensions so `tsc` output works on Node) — import from there, not `@prisma/client`; the folder is generated, don't edit it. A driver adapter (`@prisma/adapter-pg`) is required when constructing the client.
- Schema (`prisma/schema.prisma`) covers all PRD models: `Admin`, `RefreshToken`, `Service`, `Artist`, `Booking`, `BookingStatusHistory`, `BusinessHour` (times are `"HH:mm"` strings in Asia/Jakarta, with optional break), `BlockedSlot` (`artistId` null = whole studio). UUID ids come from `gen_random_uuid()`, all timestamps are `timestamptz`, tables/columns are snake_case via `@@map`/`@map`.
- The migration `*_data_model` holds what Prisma can't express: the `bookings_no_overlap` EXCLUDE constraint and CHECK constraints (booking/blocked-slot time order, service duration multiple of 15, business-hour formats). Prisma doesn't track these, so copy them forward if you ever regenerate. An exclusion violation surfaces as `PrismaClientKnownRequestError` code `P2039` with the Postgres code at `meta.driverAdapterError.cause.originalCode === "23P01"`.
- `migrate dev` needs a TTY and `migrate reset` is refused for AI agents without user consent; to generate SQL non-interactively use `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` against a migrated scratch database. `bun run db:seed` is idempotent (one artist, seven closed business-hour rows); the admin account and services/hours data are not seeded yet.

Rules from the PRD that shape new code:
- **No double booking, enforced in the DB**: a Postgres `EXCLUDE USING gist` constraint on `bookings` (`artist_id` + `tstzrange(start_at, end_at)`, for `pending`/`confirmed`). Prisma can't express it, so it goes in a hand-edited migration (`prisma migrate dev --create-only`). Never edit released migrations. Map SQLSTATE `23P01` to `409 SLOT_UNAVAILABLE`.
- Errors: throw `AppError(code, httpStatus, message, details?)`; a central handler returns `{ error: { code, message, details } }`; unknown errors become `500 INTERNAL_ERROR` without leaking details.
- Time: store `timestamptz` (UTC); API speaks ISO 8601 with `+07:00`; business-hour rules computed in Asia/Jakarta. Phones normalized to E.164.
- Bun-dev / Node-prod parity: production runs `tsc` output on Node 26 (`Dockerfile.prod`, multi-stage; the `verify` stage runs lint, typecheck, unit tests, build and the Node smoke test, and the runtime/migrator images copy from it). Don't use `Bun.*` / `bun:*` in `src/`, and relative imports must use `.js` extensions (`module: NodeNext`).
- Auth plan: argon2id passwords, 15-minute JWT access tokens, rotating refresh tokens stored hashed; customers book without accounts (lookup by booking code + phone, mismatch returns 404 not 403).
