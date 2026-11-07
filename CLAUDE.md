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
bun run dev          # bun --watch src/index.ts
bun run start        # bun src/server.ts (note: src/server.ts doesn't exist yet; entry is currently src/index.ts)
bun run typecheck    # tsc --noEmit
bunx eslint .        # no "lint" script yet
bun --bun run prisma migrate dev    # run Prisma CLI via bun, per prisma7.config.ts header
bun --bun run prisma generate
docker compose -f compose.dev.yml up -d --build   # app + postgres (podman compose also works)
```

No test runner or tests exist yet. The PRD plans `bun test` with `tests/unit` and `tests/integration` (single file: `bun test path/to/file.test.ts`).

Env: copy `.env.example` to `.env`. Compose reads `POSTGRES_USER/PASSWORD/DB` and builds `DATABASE_URL` for the container; Prisma CLI on the host needs `DATABASE_URL` in `.env` (read by `prisma7.config.ts` via `dotenv`).

## Architecture

Layered: `routes → controller → services → repositories → PostgreSQL`. Upper layers call lower ones only; the PRD requires that **only `repositories/` imports Prisma Client** (intended to be enforced via ESLint). Currently only a hello-world slice exists (`routes/app.route.ts` → `controller/app.controller.ts` → `services/app.service.ts`); `repositories/`, `middleware/`, `utils/` are not yet created. Note the directory is `controller/` (singular) in the repo, whereas the PRD's target layout uses `controllers/`.

Prisma specifics (v7):
- Config lives in `prisma7.config.ts` (the PRD calls it `prisma.config.ts`); the datasource URL is set there, not in `schema.prisma`.
- Client is generated to `src/generated/prisma` (generator `prisma-client`) — import from there, not `@prisma/client`; the folder is generated, don't edit it. A driver adapter (`@prisma/adapter-pg`) is required when constructing the client.
- Current schema has `Users` and `RefreshToken` (tokens stored as hashes). The PRD's target models (services, artists, bookings, booking_status_history, business_hours, blocked_slots, admins) are not yet in the schema; the PRD names the admin model `Admin`.

Rules from the PRD that shape new code:
- **No double booking, enforced in the DB**: a Postgres `EXCLUDE USING gist` constraint on `bookings` (`artist_id` + `tstzrange(start_at, end_at)`, for `pending`/`confirmed`). Prisma can't express it, so it goes in a hand-edited migration (`prisma migrate dev --create-only`). Never edit released migrations. Map SQLSTATE `23P01` to `409 SLOT_UNAVAILABLE`.
- Errors: throw `AppError(code, httpStatus, message, details?)`; a central handler returns `{ error: { code, message, details } }`; unknown errors become `500 INTERNAL_ERROR` without leaking details.
- Time: store `timestamptz` (UTC); API speaks ISO 8601 with `+07:00`; business-hour rules computed in Asia/Jakarta. Phones normalized to E.164.
- Bun-dev / Node-prod parity: production runs compiled JS on Node 26. Don't use `Bun.*` / `bun:*` APIs in `src/`. Relative imports must include the extension (the repo currently uses `.ts` extensions with `allowImportingTsExtensions`; the PRD's production build plan instead assumes `.js` extensions — resolve this when the build setup is added).
- Auth plan: argon2id passwords, 15-minute JWT access tokens, rotating refresh tokens stored hashed; customers book without accounts (lookup by booking code + phone, mismatch returns 404 not 403).
