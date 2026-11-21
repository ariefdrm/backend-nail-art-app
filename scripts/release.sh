#!/usr/bin/env bash
# Only supported release path. Stops at the first failure.
set -euo pipefail

TAG="$(git rev-parse --short HEAD)"

# Gate B: integration tests inside the dev container (real PostgreSQL).
# `--entrypoint sh` skips dev-entrypoint.sh (podman-compose ignores `--entrypoint ""` and would start the
# dev server instead), so install into the bind-mounted node_modules and generate the client here.
podman compose -f compose.dev.yaml up -d db
podman compose -f compose.dev.yaml run --rm --no-deps --entrypoint sh backend -c "bun install --frozen-lockfile && bun --bun run prisma generate && bun run db:test:reset && bun run test:integration"

# Gate A: production build (lint, typecheck, unit tests, build, Node smoke test run in the `verify` stage)
podman build -f Dockerfile.prod --target runtime  -t nailpalace-api:"$TAG" .
podman build -f Dockerfile.prod --target migrator -t nailpalace-migrator:"$TAG" .

# Start production only if everything above passed
IMAGE_TAG="$TAG" podman compose -f compose.prod.yaml up -d
