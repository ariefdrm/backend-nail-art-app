# backend-nail-art-app

Backend REST API built with Express.js, TypeScript, Bun, Prisma ORM, and PostgreSQL.

> [!IMPORTANT]
> Contributor Guide: Before contributing to this project, please read the [![Git Workflow](https://img.shields.io/badge/Contribution-Git_Workflow-blue?logo=git)](./GIT_WORKFLOW.md) to understand our branching strategy, commit conventions, and pull request process.

## Project Overview

---

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Running with docker compose

```bash
docker compose -f compose.dev.yml up -d --build
```

## Project Directory

```bash
backend-nail-art-app/
│
├── bun.lock                     # Bun dependency lockfile
├── compose.dev.yml              # Docker Compose configuration for development
├── Dockerfile.dev               # Docker image configuration for development environment
├── eslint.config.mjs            # ESLint configuration for code quality and linting
├── package.json                 # Project metadata, dependencies, and npm scripts
├── prisma/                      # Prisma ORM configuration and database management
│   ├── migrations/              # Database migration history
│   └── schema.prisma            # Database models, relations, and Prisma schema
├── prisma7.config.ts            # Prisma 7 configuration (schema, migrations, datasource)
├── README.md                    # Project documentation and setup instructions
├── skills-lock.json             # Dependency lockfile for installed project skills
├── src/                         # Main application source code
│   ├── controller/              # Handles HTTP requests and HTTP responses
│   │   └── app.controller.ts    # Application-level request handlers
│   ├── index.ts                 # Express.js application entry point and initialization
│   ├── middleware/              # Custom middleware (authentication, validation, error handling)
│   ├── repositories/            # Handles database access and data persistence
│   ├── routes/                  # Defines and organizes API endpoints
│   │   ├── app.route.ts         # Application-specific API route definitions
│   │   └── index.ts             # Centralizes and registers application routes
│   ├── services/                # Contains business logic and application services
│   │   └── app.service.ts       # Application-level business logic implementation
│   └── utils/                   # Reusable utility functions and helper modules
└── tsconfig.json                # TypeScript compiler configuration
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
