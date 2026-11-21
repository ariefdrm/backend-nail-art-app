#!/bin/sh
# Dev container entrypoint: install dependencies, generate the Prisma client, apply existing migrations,
# start watch mode.
#
# compose.dev.yaml bind-mounts ./node_modules, which hides the copy installed in the image, so the
# install runs here, after the mount: it fills the host folder too, for the code editor.
#
# `migrate deploy` is used because `migrate dev` needs an interactive terminal and
# hangs/fails in a container. To create a new migration, run it yourself with a TTY:
#   docker compose -f compose.dev.yaml exec backend bun --bun run prisma migrate dev
set -eu

bun install --frozen-lockfile
bun --bun run prisma generate
bun --bun run prisma migrate deploy
exec bun run dev
