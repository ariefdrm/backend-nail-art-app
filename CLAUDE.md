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
bun run test:integration # needs PostgreSQL (the *_test database)
bun run verify           # lint + typecheck + unit tests + build
bun run prisma:generate  # required after install/schema changes; output is gitignored
bun --bun run prisma migrate dev
node dist/scripts/smoke.js   # Node smoke test of the compiled build
docker compose -f compose.dev.yaml up -d --build   # app + postgres (podman compose also works)
scripts/release.sh       # only supported release path (integration tests -> prod image build -> compose.prod.yaml)
```

Single test: `bun test path/to/file.test.ts`. No tests exist yet (scripts use `--pass-with-no-tests`).

Env: copy `.env.example` to `.env` (all PRD variables are listed there). Compose builds the container `DATABASE_URL` from `POSTGRES_*`; Prisma CLI on the host needs `DATABASE_URL` in `.env` (read by `prisma.config.ts`). Production secrets go in `.env.prod` (gitignored).

## Architecture

Layered: `routes → controller → services → repositories → PostgreSQL`. Upper layers call lower ones only; the PRD requires that **only `repositories/` imports Prisma Client** (intended to be enforced via ESLint). ESLint enforces this (layer imports, Prisma only in `repositories/` and `utils/prisma.ts`, no Bun APIs in `src/`). `src/app.ts` builds the Express app and `src/server.ts` listens (with graceful shutdown); routes mount at `/api/v1` plus `/health/live`. Currently only a placeholder hello-world slice exists (`routes/app.route.ts` → `controllers/app.controller.ts` → `services/app.service.ts`); `repositories/`, `middleware/`, `utils/` are empty.

Prisma specifics (v7):
- Config lives in `prisma.config.ts`; the datasource URL is set there, not in `schema.prisma`.
- Client is generated to `src/generated/prisma` (generator `prisma-client`, ESM with `.js` import extensions so `tsc` output works on Node) — import from there, not `@prisma/client`; the folder is generated, don't edit it. A driver adapter (`@prisma/adapter-pg`) is required when constructing the client.
- Current schema has `Users` and `RefreshToken` (tokens stored as hashes). The PRD's target models (services, artists, bookings, booking_status_history, business_hours, blocked_slots, admins) are not yet in the schema; the PRD names the admin model `Admin`.

Rules from the PRD that shape new code:
- **No double booking, enforced in the DB**: a Postgres `EXCLUDE USING gist` constraint on `bookings` (`artist_id` + `tstzrange(start_at, end_at)`, for `pending`/`confirmed`). Prisma can't express it, so it goes in a hand-edited migration (`prisma migrate dev --create-only`). Never edit released migrations. Map SQLSTATE `23P01` to `409 SLOT_UNAVAILABLE`.
- Errors: throw `AppError(code, httpStatus, message, details?)`; a central handler returns `{ error: { code, message, details } }`; unknown errors become `500 INTERNAL_ERROR` without leaking details.
- Time: store `timestamptz` (UTC); API speaks ISO 8601 with `+07:00`; business-hour rules computed in Asia/Jakarta. Phones normalized to E.164.
- Bun-dev / Node-prod parity: production runs `tsc` output on Node 26 (`Dockerfile.prod`, multi-stage; the `verify` stage runs lint, typecheck, unit tests, build and the Node smoke test, and the runtime/migrator images copy from it). Don't use `Bun.*` / `bun:*` in `src/`, and relative imports must use `.js` extensions (`module: NodeNext`).
- Auth plan: argon2id passwords, 15-minute JWT access tokens, rotating refresh tokens stored hashed; customers book without accounts (lookup by booking code + phone, mismatch returns 404 not 403).
