# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Backend REST API for **The Nail Palace**, a single-owner nail art studio in Jambi, Indonesia. It handles service catalog, slot availability, anti-double-booking reservations, admin management, and a dashboard. Stack: Express 5, TypeScript (strict), Bun (dev), Prisma ORM 7 + `@prisma/adapter-pg`, PostgreSQL, zod.

Source-of-truth documents (the PRD is written in Indonesian):
- `PRD_Backend_The_Nail_Palace.md` — requirements (FR-01..FR-16), target architecture, container/release design, env vars, test strategy.
- `documents/openapi.yaml` — API contract. **If the PRD and openapi.yaml conflict, openapi.yaml wins** and the PRD gets updated. Update the contract first when changing an endpoint.
- `GIT_WORKFLOW.md` — branch from `develop` (`feature/`, `fix/`, ...), commit message convention, PR process. Read before committing.

## Git workflow rules

Follow `GIT_WORKFLOW.md`. Everything reaches `main` only via `develop`.

- **Never commit or push directly to `main` or `develop`**; work on a temporary branch (`feature/`, `fix/`, `docs/`, `chore/`, ...).
- **Start every branch from an up-to-date `develop`**: `git switch develop && git fetch origin && git pull --ff-only origin develop`, then `git switch -c <branch>`. Do **not** stack a branch on another unmerged feature branch; finish and merge one module's PR before starting the next.
- **Every PR's base is `develop`** (never another feature branch). Only `develop` → `main` PRs target `main`. Rebase on `origin/develop` before opening a PR; use `--force-with-lease`, never `--force`, and never rebase a branch others are using.
- **The repository's default branch is `main`, and `develop` is the staging branch.** Because of that, `gh pr create` and GitHub's "new PR" page default to `main`: always pass `--base develop` (or pick `develop` in the UI). The only PR allowed to target `main` is `develop` → `main`, used for releases; the `PR base` CI check fails any other PR aimed at `main`.
- **Commits use Conventional Commits with a scope**: `type(scope): description`, e.g. `feat(catalog): add public services endpoints`. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
- **Merging needs at least one approval from another collaborator**; don't merge PRs yourself or with failing checks. Delete merged branches (local and remote) only when the user says so.
- Never commit `.env` files or secrets (only `.env.example`). Keep PRs focused on one task.
- The user does not want a `Co-Authored-By` line (or other attribution) in commit messages.

## Development plan (modules)

The backend is built module by module, in the order below, following the PRD's FR numbers. **One module = one branch = one PR into `develop`**, started from an up-to-date `develop` (see the git rules above). A module's "Needs" column lists modules that must already be merged into `develop`; modules with no unmet needs can be built in parallel by different people. Each module includes its own unit/integration tests (PRD Definition of Done) and updates `documents/openapi.yaml` first if the contract changes. **When a module's PR is ready, flip its row to `done` in this table in the same PR**, so the plan stays accurate for the next session.

| # | Branch | Scope | Needs | Status |
|---|---|---|---|---|
| 1 | `feature/core-infrastructure` | env validation, `AppError` + error handler, request-id, logging, `validate()`, Prisma singleton, health routes | none | done (PR #2) |
| 2 | `feature/data-model` | all PRD tables, `bookings_no_overlap` EXCLUDE + CHECK constraints, seed | 1 | done (PR #7) |
| 3 | `feature/admin-auth` | FR-06: login, refresh rotation, `/auth/me`, `authenticate` / `requireRole`; logout and logout-all added later in `feature/auth-logout` | 2 | done (PR #7) |
| 4 | `feature/catalog` | FR-01, FR-02, FR-08: public services + artists, admin CRUD for both | 2, 3 | done (PR #17) |
| 5 | `feature/schedule-management` | FR-09: business hours, blocked slots | 2, 3 | done (PR #19) |
| 6 | `feature/availability` | FR-03: `GET /availability` slot calculation | 4, 5 | done (PR #21) |
| 7 | `feature/public-booking` | FR-04, FR-05, FR-11: create / look up / cancel booking, status history, concurrency test (map `23P01` to `409 SLOT_UNAVAILABLE`) | 6 | done |
| 8 | `feature/admin-booking` | FR-07, FR-13: list/filter, status transitions, reschedule, manual booking, `wa.me` reminder link | 3, 7 | done |
| 9 | `feature/dashboard` | FR-10: `/admin/dashboard/summary` | 8 | done |
| 10 | `security/hardening` | FR-12, FR-14: rate limits (login, `POST /bookings`), helmet, CORS allowlist, `trust proxy`, protected `/docs`, contract tests against `openapi.yaml`, PRD security checklist | 8 | done |
| 11 | `feature/export-csv` | FR-15 (done); FR-16 (P2, optional) waits for PRD question 7: nothing in the PRD says which ML service or score format | 8 | done (FR-15 only) |
| 12a | `feature/notifications` | FR-17: `notifications` + per-admin reads, events written in the booking transaction (new online booking, customer cancel), 60 s in-process scheduler (unconfirmed nudge, upcoming reminder), `/admin/notifications*` | 7 | done |
| 12b | `feature/web-push` | FR-17: `push_subscriptions`, VAPID env vars, `web-push` sender driven by `notifications.pushed_at`, `/admin/push*` | 12a | next |

**Deadline: Tuesday 8 December 2026** (prototype demo to the owner). Checkpoints (full table in PRD section 12): 14 Nov hours/blocking + availability, 21 Nov public booking, 28 Nov admin booking + dashboard (the demo-complete prototype; if missed, Web Push and CSV export are deferred first), 3 Dec notification inbox + basic hardening, 4-7 Dec Web Push if on schedule, frontend integration, rehearsal, buffer.

Open items to settle during the relevant module:
- **Decisions already made (do not re-ask; details in the PRD):**
  - Booking confirmation is manual (`pending` to `confirmed` by the owner). `artist_id` is optional in the API and hidden by default in the frontend; when omitted the system picks an available artist.
  - `BusinessHour` gets optional `break_start` / `break_end` in the contract (module 5, contract first).
  - Blocking time that already has bookings is allowed but never silent (module 5, FR-09): `POST /admin/blocked-slots/check` previews affected `pending`/`confirmed` bookings; `POST /admin/blocked-slots` answers `409 BLOCK_HAS_BOOKINGS` (new error code, add to `ErrorCode` and the contract) unless the body has `acknowledge_conflicts: true`; nothing is cancelled automatically. Affected bookings are computed, not stored, and carry a `contact_url` (`wa.me` link with a ready-to-send message; one shared builder, reused for FR-13 `reminder_url`). The owner agrees the new time or the cancellation with the customer in chat and records it via reschedule/cancel (module 8) plus `admin_note`. Module 7 exposes `schedule_conflict` on the public booking status and takes the same advisory lock as block creation; module 12a adds a nudge for unresolved conflicts.
  - `BOOKING_BUFFER_MINUTES` (default 15) is applied: an active booking occupies its artist for `[start_at, end_at + buffer)`, and two bookings may sit side by side only if those occupied ranges do not overlap (so the buffer also separates a new slot from a booking that follows it). Blocked slots, the break and closing time use exact times. The `bookings_no_overlap` constraint only knows the raw ranges, so `createBookingLocked` re-checks the buffer (and blocked slots) under the schedule advisory lock; admin-created bookings (module 8) must go through the same lock and check.
  - Status transitions (the document the PRD pointed to, `Kontrak_API_dan_Format_Data.md`, is not in the repo, so these are defined in `utils/booking-status.ts` and `openapi.yaml`): `pending` to `confirmed`/`cancelled`; `confirmed` to `completed`/`cancelled`/`no_show`; the other statuses are final. `cancelled` needs a reason (422). `completed` and `no_show` are refused before `start_at` because they release the slot. Every change writes a history row with the admin id; `confirmed_at` is stamped when confirming.
  - Admin reschedule (`PATCH /admin/bookings/{id}`) applies to `pending`/`confirmed` only and follows the same slot, buffer and blocked-slot rules as a new booking (the booking itself is ignored while checking). Artist stays the same unless `artist_id` is sent; changing the service copies the new price, a plain reschedule keeps the price snapshot. Notes can be edited on any status. Admin manual bookings (`POST /admin/bookings`) go through the same `placeBooking` as online ones, born `confirmed` with `source = admin`.
  - Dashboard metrics (`GET /admin/dashboard/summary`, module 9): the period is by `start_at` in WIB days (both ends inclusive, at most 366 days) and counts every status. `no_show_rate` = no_show / (completed + no_show); `online_booking_ratio` = online / all bookings in the period; `revenue_completed` sums `total_price` of completed bookings; `avg_confirmation_minutes` averages `confirmed_at - created_at` over online bookings that were confirmed (admin bookings are born confirmed and would drag it to 0). Rates are `null`, not 0, when there is nothing to divide by.
  - Hardening (module 10): the deployment is **one HTTPS reverse proxy in front of the container**, so `TRUST_PROXY` defaults to 1 in production and 0 elsewhere (set in `server.ts`, not `app.ts`; without it every client shares the proxy's IP and one rate-limit bucket). Limiters (`middleware/rate-limit.ts`, in-memory, per IP, so one instance only): login/refresh count failed attempts only (10 per 15 min), `POST /bookings` 10 per hour, booking lookup/cancel 30 per 15 min, whole API 300 per minute; all configurable via `RATE_LIMIT_*_MAX`, and a limit answers `429 RATE_LIMITED`. `helmet` defaults apply to the API; CORS allows exactly the origins in `CORS_ORIGINS` (no credentials). `/docs` (Swagger UI served locally from `swagger-ui-dist`, spec at `/docs/openapi.yaml`) is open outside production; in production it exists only when `DOCS_PASSWORD` is set and then needs HTTP Basic auth (`DOCS_USER`), otherwise 404. The test setup raises the limits so suites sharing one IP are not throttled.
  - Contract tests (`tests/integration/contract.test.ts`, helper `tests/helpers/contract.ts`) check real responses against `openapi.yaml`: the status must be documented for the operation, the body must validate, and it must not contain undocumented fields. When you add or change an endpoint, update the contract and extend this suite.
  - CSV export (module 11, FR-15, `GET /admin/export/bookings.csv`, owner only): one row per booking ordered by `start_at`, streamed from the database in keyset-paginated batches of 500. It deliberately exports **no personal data** (no name, phone, booking code or free-text notes); customers are linked through `customer_ref`, a 16-hex HMAC of the phone keyed from `JWT_REFRESH_SECRET` (rotating that secret changes every ref). Text cells that start with `= + - @` get a leading apostrophe (CSV injection). The column list is documented in `openapi.yaml`; change both together. FR-16 (risk score hook) is not built: it needs the answer to PRD question 7.
  - Notifications (module 12a, FR-17): the defaults listed below were adopted. Events are written **in the same transaction** as the booking change (`createBookingLocked`, `cancelActiveBooking` take a `notification`): a new online booking and a customer cancel; a booking the admin makes or cancels is not news to the admins. A 60 s in-process scheduler (`jobs/notification-scheduler.ts`, started from `server.ts` only) creates `unconfirmed_reminder` (pending longer than `NOTIFY_UNCONFIRMED_AFTER_MINUTES`, 15), `upcoming_reminder` (confirmed, starting within `NOTIFY_UPCOMING_MINUTES_BEFORE`, 120) and `schedule_conflict` (an active booking running into a blocked slot) notifications. Each event has a unique `dedupe_key` (`<type>:<booking id or code>`), so repeated or concurrent runs never duplicate. Read state is per admin (`notification_reads`); the inbox shows the last 30 days; the frontend polls `GET /admin/notifications/unread-count`. Text carries only code, service, time and the customer's **first name**: never a phone number, surname, the customer's cancel reason, or the owner's block reason (`services/notification.messages.ts`). The in-memory scheduler is fine for one instance; a second instance is safe because of the dedupe key. Old notifications are not deleted yet (only hidden after 30 days).
  - Customer lookup/cancel treat an unparsable phone like any other mismatch (404, never 422), so the endpoints cannot be used to probe codes.
  - The backend cannot send WhatsApp messages (PRD non-goal) and cannot verify the customer's consent; it only prepares the message and records the owner's outcome.
- Services and real business hours are not seeded yet (waiting for the `services.csv` / `jam_operasional.csv` files); the seed only creates one artist, closed hours, and the admin from `ADMIN_SEED_*` (module 4/5).
- Notifications (12a/12b, FR-17) were designed after the PRD: Web Push is allowed (it is not the excluded WhatsApp API). Defaults to confirm during review: all admins receive them with per-admin read state, the frontend polls `unread-count` (SSE later), 15 min unconfirmed nudge, 120 min upcoming reminder, no phone numbers in any notification text or push payload. The scheduler starts in `server.ts` only, never in `app.ts`. The service worker and "enable notifications" UI belong to `nail-art-frontend-app`.
- Commits on modules 1-3 lack a scope; that is history, so only new commits need `type(scope):`.

### Working in parallel
- The chain is 5, then 6 (which also needs 4), then 7. After module 7 is merged, modules 8, 9, 10 and 12a do not depend on each other, so different people or sessions can build them at the same time.
- Files every module touches, so keep edits there to a line or two and rebase on `origin/develop` before opening the PR: `src/routes/index.ts` (one `import` and one `use` per router), `documents/openapi.yaml`, the plan table above (flip only your own row), and `prisma/migrations` (only 12a and 12b add tables; give them to one person).
- The frontend (`nail-art-frontend-app`) can work against a mock server generated from `documents/openapi.yaml` (for example Prism), so it does not wait for the backend. Change the contract first and tell the frontend. Web Push needs a service worker in that repo: confirm they have capacity before starting 12b.
- Reviews (one approval required) are the likely bottleneck, so keep each PR small and single-purpose.

### Still undecided (PRD section 14)
- Deploy location and the HTTPS reverse proxy (question 3), database backup (question 5), and what the AI team needs from the backend (question 7, which keeps FR-15 and FR-16 tentative). None of them blocks modules 5 to 9. Question 4 (CI) is settled: GitHub Actions.

### Repository settings (GitHub, not stored in git)
Branch protection for `develop` and `main`, the required check names, and the "delete head branches on merge" setting are recommended in `GIT_WORKFLOW.md` section 10. The repository cannot show whether they are enabled: check Settings, Rules.

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
bun run test:integration # DB-backed tests need DATABASE_URL_TEST and skip without it
bun run test             # unit then integration, in separate processes (unit tests use mock.module, which would leak)
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
- The migration `*_data_model` holds what Prisma can't express: the `bookings_no_overlap` EXCLUDE constraint and CHECK constraints (booking/blocked-slot time order, service duration multiple of 15, business-hour formats). Prisma doesn't track these, so copy them forward if you ever regenerate. An exclusion violation surfaces as `PrismaClientKnownRequestError` code `P2039` with the Postgres code at `meta.driverAdapterError.cause.originalCode === "23P01"`. A foreign key `RESTRICT` violation (e.g. deleting a service that has bookings) surfaces as code `P2003` (Postgres reports `23001`, not `23503`); `prismaErrorCode()` and `sqlState()` in `utils/prisma.ts` read these.
- `migrate dev` needs a TTY and `migrate reset` is refused for AI agents without user consent; to generate SQL non-interactively use `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` against a migrated scratch database. `bun run db:seed` is idempotent (one artist, seven closed business-hour rows, and the owner admin when `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` (>= 12 chars) are set; an existing admin is never overwritten); services and real business hours are not seeded yet.

Rules from the PRD that shape new code:
- **No double booking, enforced in the DB**: a Postgres `EXCLUDE USING gist` constraint on `bookings` (`artist_id` + `tstzrange(start_at, end_at)`, for `pending`/`confirmed`). Prisma can't express it, so it goes in a hand-edited migration (`prisma migrate dev --create-only`). Never edit released migrations. Map SQLSTATE `23P01` to `409 SLOT_UNAVAILABLE`.
- Errors: throw `AppError(code, httpStatus, message, details?)`; a central handler returns `{ error: { code, message, details } }`; unknown errors become `500 INTERNAL_ERROR` without leaking details.
- Time: store `timestamptz` (UTC); API speaks ISO 8601 with `+07:00`; business-hour rules computed in Asia/Jakarta. Phones normalized to E.164.
- Bun-dev / Node-prod parity: production runs `tsc` output on Node 26 (`Dockerfile.prod`, multi-stage; the `verify` stage runs lint, typecheck, unit tests, build and the Node smoke test, and the runtime/migrator images copy from it). Don't use `Bun.*` / `bun:*` in `src/`, and relative imports must use `.js` extensions (`module: NodeNext`).
- Admin auth (implemented per `openapi.yaml`: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`): passwords are argon2id (`@node-rs/argon2`, prebuilt for Bun, Node and musl); access tokens are 15-minute HS256 JWTs via `jose` (issuer/audience checked, `role` claim); refresh tokens are opaque random strings stored only as an HMAC (keyed with `JWT_REFRESH_SECRET`) and rotated on every use. Presenting an already-used refresh token, or losing a rotation race, revokes all of that admin's sessions. Login returns the same 401 for unknown email and wrong password (it verifies against a dummy hash to keep timing similar). Protect routes with `authenticate` (+ `requireRole("owner")`) from `middleware/auth.ts` and read the caller with `getAuthAdmin(res)`. `logout` takes a refresh token and is idempotent (always 204, never reveals whether the token existed, and does not trigger the reuse/theft revocation); `logout-all` needs a bearer token and revokes all of that admin's refresh tokens. Access tokens are stateless, so they stay valid until their 15 minutes run out. Customers book without accounts (lookup by booking code + phone, mismatch returns 404 not 403).
- Schedule and blocked slots (module 5, FR-09): `GET/PUT /admin/business-hours` (always 7 days; the week is replaced atomically; closed days are stored without times; optional break) and `GET/POST /admin/blocked-slots`, `POST /admin/blocked-slots/check`, `DELETE /admin/blocked-slots/{id}`. Creating a block runs under a PostgreSQL advisory lock (`SCHEDULE_LOCK_KEY`, via `withScheduleLock()` in `repositories/schedule.repository.ts`); **booking creation (module 7) must take the same lock** and check blocked slots inside that transaction, otherwise a block and a booking created at the same instant can both succeed. `findActiveBookingsOverlapping()` (`booking.repository.ts`) is the shared half-open overlap query for `pending`/`confirmed` bookings. Overlapping bookings produce `409 BLOCK_HAS_BOOKINGS` (extra `conflicts` array in the error body) unless `acknowledge_conflicts: true`; each affected booking gets a `contact_url` from `utils/whatsapp.ts` (`wa.me` link, text never includes the owner's reason). Asia/Jakarta has no DST, so `utils/datetime.ts` uses a fixed +07:00 offset (no date library): `toJakartaIso()` for API output, `jakartaDayStart()` for date filters.

## Conventions

Match the existing modules (the auth module is the reference slice) instead of inventing new patterns. Formatting is enforced by Prettier (`bun run format` to fix, `format:check` is part of `verify`): double quotes, semicolons, 2 spaces, trailing commas, 120 columns.

### Adding a module (vertical slice), in this order
1. **Contract first**: update `documents/openapi.yaml` if an endpoint, field, or error changes; code follows the contract.
2. `src/schemas/<feature>.schema.ts`: zod schemas exported as `{ body?, query?, params? }` objects (e.g. `loginSchemas`), passed to `validate()` and typed with `getValidated<typeof xSchemas>(res)`.
3. `src/repositories/<entity>.repository.ts`: the only layer using Prisma (`getPrisma()`); plain exported functions, no business rules. Map database errors here or in the service (e.g. `23P01` to `AppError.slotUnavailable()`).
4. `src/services/<feature>.service.ts`: business rules; throws `AppError`; no Express types and no Prisma imports. Returns plain API-shaped objects (snake_case as in the contract), never raw Prisma rows (no `passwordHash`).
5. `src/controllers/<feature>.controller.ts`: thin; read validated input, call the service, respond with `ok(...)` / `paginated(...)` and an explicit status. No try/catch (Express 5 forwards async errors to the error handler).
6. `src/routes/<feature>.routes.ts`: `validate(...)` per route, `authenticate` (+ `requireRole(...)`) for admin routes under `/admin/*`; mount the router on `v1` in `src/routes/index.ts`.
7. Tests (see below), then update docs (flip the module's row in the development plan, README/`.env.example` if env or commands changed).

### Naming and style
- Files: `<name>.<layer>.ts` in lowercase kebab-case (`refresh-token.repository.ts`). Functions/variables camelCase, types PascalCase, env vars UPPER_SNAKE.
- JSON in/out is snake_case (the contract); TypeScript and Prisma fields are camelCase; database tables/columns are snake_case via `@@map`/`@map`.
- Imports always end in `.js`; use `import type` for type-only imports (ESLint enforces both). Named exports for functions; default export for routers and the app.
- User-facing error messages are in Indonesian and match the examples in `openapi.yaml`; new error codes must be added to `ErrorCode` in `utils/errors.ts` and to the contract.
- Log with `utils/logger.ts`, not `console` (only boot-time failure output in `server.ts` and scripts use `console`). Never log secrets or phone numbers.
- Money is an integer in Rupiah; timestamps are `timestamptz` in the database and ISO 8601 with `+07:00` in the API.
- Zod 4 runs object-level `superRefine` even when a field of that object already failed (and before `transform` output exists); guard with `instanceof Date` / format checks before comparing, or malformed input becomes a 500 instead of a 422. Only compare values that passed their own format check, so one bad value gives one clear error.

### Tests
- `tests/unit/**`: mock repositories with `await mock.module(...)` and then `await import(...)` the unit under test. Because `mock.module` is process-wide, unit and integration suites must run in separate processes (`bun run test` already does).
- `tests/integration/**`: drive the real Express app over HTTP (`app.listen(0)` and `fetch`); database-backed suites use `tests/helpers/db.ts`, run only when `DATABASE_URL_TEST` is set, and clean tables in `beforeEach`.
- Wrap Prisma calls in `Promise.resolve(...)` inside `expect(...).rejects/.resolves`; Bun needs a real Promise and Prisma returns a lazy one.
- Cover the failure paths the PRD calls out (validation, 401/403, 404 vs 403 for customer lookups, `SLOT_UNAVAILABLE`, invalid status transitions). Unit coverage target for `services/` and `utils/` is 80% or more.
