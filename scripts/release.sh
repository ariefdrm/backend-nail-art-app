#!/usr/bin/env bash
# Only supported release path. Stops at the first failure.
set -euo pipefail

TAG="$(git rev-parse --short HEAD)"

# Gate B: integration tests inside the dev container (real PostgreSQL)
podman compose -f compose.dev.yaml up -d db
podman compose -f compose.dev.yaml run --rm --no-deps --entrypoint "" backend sh -c "bun run db:test:reset && bun run test:integration"

# Gate A: production build (lint, typecheck, unit tests, build, Node smoke test run in the `verify` stage)
podman build -f Dockerfile.prod --target runtime  -t nailpalace-api:"$TAG" .
podman build -f Dockerfile.prod --target migrator -t nailpalace-migrator:"$TAG" .

# Start production only if everything above passed
IMAGE_TAG="$TAG" podman compose -f compose.prod.yaml up -d
