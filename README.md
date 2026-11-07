# backend-nail-art-app

Backend REST API built with Express.js, TypeScript, Bun, Prisma ORM, and PostgreSQL.

> [!IMPORTANT]
> Contributor Guide: Before contributing to this project, please read the [![Git Workflow](https://img.shields.io/badge/Contribution-Git_Workflow-blue?logo=git)](./GIT_WORKFLOW.md) to understand our branching strategy, commit conventions, and pull request process.

## Project Overview

---

```bash
bun install
```

Development (Bun runs TypeScript directly):

```bash
bun run dev
```

Production-style build (transpile with `tsc`, run on Node.js 26):

```bash
bun run build
bun run start
```

Checks: `bun run lint`, `bun run typecheck`, `bun run test:unit`, or all at once with `bun run verify`.

## Running with docker compose

```bash
docker compose -f compose.dev.yaml up -d --build
```

## Release

`scripts/release.sh` is the only supported release path: integration tests in the dev container, then `Dockerfile.prod` (lint, typecheck, unit tests, build and a Node smoke test run in its `verify` stage), then `compose.prod.yaml`. Production secrets go in `.env.prod` (not committed).

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
│   └── schema.prisma
├── prisma.config.ts             # Prisma 7 configuration (schema, migrations, datasource)
├── PRD_Backend_The_Nail_Palace.md  # Product requirements
├── scripts/
│   ├── db-init.sh               # Creates the *_test database on first start
│   ├── dev-entrypoint.sh        # Dev container entrypoint (generate, migrate, watch)
│   └── release.sh               # Release gate: tests, build images, start production
├── src/
│   ├── app.ts                   # Builds the Express app (no listen, easy to test)
│   ├── server.ts                # Entry point: listen and graceful shutdown
│   ├── controllers/             # Handle HTTP requests and responses
│   ├── middleware/              # Auth, validation, error handling
│   ├── repositories/            # Database access (only layer that imports Prisma)
│   ├── routes/                  # Endpoint definitions (mounted at /api/v1, plus /health)
│   ├── scripts/smoke.ts         # Node smoke test run against the compiled build
│   ├── services/                # Business logic
│   └── utils/                   # Helpers
├── tsconfig.build.json          # Production build (src only, emits to dist/)
└── tsconfig.json                # Editor/typecheck config
```

## Dependencies

The following packages are required to run the application:

| Package              | Version   | Description                                        |
| -------------------- | --------- | -------------------------------------------------- |
| `@prisma/adapter-pg` | `^7.10.1` | PostgreSQL driver adapter for Prisma ORM.          |
| `@prisma/client`     | `7`       | Prisma Client for database queries and operations. |
| `dotenv`             | `^18.0.8` | Loads environment variables from `.env` files.     |
| `express`            | `^5.3.0`  | Web framework for building REST APIs.              |
| `pg`                 | `^8.23.1` | PostgreSQL client for Node.js.                     |
| `zod`                | `^4.6.7`  | TypeScript-first schema validation library.        |

## Development Dependencies

The following packages are used for development, linting, and TypeScript compilation:

| Package             | Version    | Description                                               |
| ------------------- | ---------- | --------------------------------------------------------- |
| `@eslint/js`        | `^10.0.1`  | JavaScript recommended ESLint configurations.             |
| `@types/bun`        | `latest`   | TypeScript type definitions for Bun runtime APIs.         |
| `@types/express`    | `^5.0.6`   | TypeScript type definitions for Express.js.               |
| `@types/node`       | `^26.6.5`  | TypeScript type definitions for Node.js APIs.             |
| `@types/pg`         | `^8.23.1`  | TypeScript type definitions for PostgreSQL client.        |
| `eslint`            | `^10.13.0` | Static code analysis and linting tool.                    |
| `prisma`            | `^7.10.1`  | Prisma CLI for schema management and database migrations. |
| `typescript`        | `^6.0.2`   | TypeScript compiler.                                      |
| `typescript-eslint` | `^8.72.0`  | ESLint integration for TypeScript.                        |

This project was created using `bun init` in bun v1.4.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
